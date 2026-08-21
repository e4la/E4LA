import { audit, errorResponse, json, requestId } from '../../_shared/ops-security.js';
import { createRemainingInstallmentSchedule, verifyStripeSignature } from '../../_shared/stripe.js';
import { validateEnvironmentConfiguration, verifyDatabaseEnvironment } from '../../_shared/environment.js';
import { evaluatePortalActivation } from '../../_shared/portal-activation.js';

export async function onRequestPost({ request, env }) {
  try {
    validateEnvironmentConfiguration(env, { stripeRequired: true });
    await verifyDatabaseEnvironment(env);
    if (!env.ENROLLMENT_DB || !env.STRIPE_WEBHOOK_SECRET) {
      return json({ error: { code: 'webhook_not_configured', message: 'Webhook processing is not configured.' } }, 503);
    }
    const rawBody = await request.text();
    const signature = request.headers.get('Stripe-Signature');
    if (!await verifyStripeSignature(rawBody, signature, env.STRIPE_WEBHOOK_SECRET)) {
      return json({ error: { code: 'invalid_signature', message: 'Webhook signature rejected.' } }, 400);
    }
    const event = JSON.parse(rawBody);
    if (event.livemode === true && env.ENVIRONMENT !== 'production') return json({ error: { code: 'live_event_blocked', message: 'Live Stripe events are disabled outside production.' } }, 403);
    const now = new Date().toISOString();
    const existing = await env.ENROLLMENT_DB.prepare(`
      SELECT status, attempts FROM processed_webhook_events WHERE provider = 'stripe' AND event_id = ?
    `).bind(event.id).first();
    if (existing?.status === 'processed') return json({ received: true, duplicate: true });
    await env.ENROLLMENT_DB.prepare(`
      INSERT INTO processed_webhook_events (provider, event_id, event_type, livemode, status, attempts, received_at)
      VALUES ('stripe', ?, ?, 0, 'processing', 1, ?)
      ON CONFLICT(provider, event_id) DO UPDATE SET status = 'processing', attempts = attempts + 1, last_error = NULL
    `).bind(event.id, event.type, now).run();
    try {
      await processEvent(env, event, requestId(request));
      await env.ENROLLMENT_DB.prepare(`
        UPDATE processed_webhook_events SET status = 'processed', processed_at = ?, last_error = NULL
        WHERE provider = 'stripe' AND event_id = ?
      `).bind(new Date().toISOString(), event.id).run();
      return json({ received: true });
    } catch (processingError) {
      await env.ENROLLMENT_DB.prepare(`
        UPDATE processed_webhook_events SET status = 'failed', last_error = ?
        WHERE provider = 'stripe' AND event_id = ?
      `).bind(String(processingError.message || processingError).slice(0, 500), event.id).run();
      throw processingError;
    }
  } catch (error) {
    return errorResponse(error, request);
  }
}

async function processEvent(env, event, requestIdentifier) {
  const object = event.data?.object || {};
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    if (object.payment_status !== 'paid') return;
    const enrollmentId = object.metadata?.e4la_enrollment_id || object.client_reference_id;
    if (!enrollmentId) throw new Error('Checkout Session did not contain an E4LA enrollment identifier.');
    const enrollment = await env.ENROLLMENT_DB.prepare(`
      SELECT e.*, pp.installment_count, pp.stripe_remaining_price_id,
        aa.installment_dates_json, a.status AS agreement_status
      FROM enrollments e
      JOIN payment_plans pp ON pp.id = e.payment_plan_id
      JOIN agreement_acceptances aa ON aa.id = e.acceptance_id
      JOIN agreements a ON a.id = e.agreement_id
      WHERE e.id = ?
    `).bind(enrollmentId).first();
    if (!enrollment) throw new Error('Enrollment was not found for Checkout Session.');
    const now = new Date().toISOString();
    await saveStripeObject(env.ENROLLMENT_DB, enrollment.id, 'checkout_session', object);
    if (object.payment_intent) {
      await saveStripeReference(env.ENROLLMENT_DB, enrollment.id, 'payment_intent', object.payment_intent, 'succeeded');
    }
    await env.ENROLLMENT_DB.prepare(`UPDATE payment_installments
      SET status = 'paid', stripe_payment_intent_id = ?, paid_at = ?, updated_at = ?
      WHERE enrollment_id = ? AND installment_number = 1 AND status != 'paid'`)
      .bind(object.payment_intent || null, now, now, enrollment.id).run();
    if (Number(enrollment.installment_count) > 1) {
      const dates = JSON.parse(enrollment.installment_dates_json || '[]');
      const secondDueAt = dates[1];
      if (!secondDueAt || new Date(secondDueAt).getTime() <= Date.now()) throw new Error('The second installment due date is missing or not in the future.');
      await env.ENROLLMENT_DB.prepare(`UPDATE enrollments SET status = 'schedule_pending', next_payment_due_at = ?, updated_at = ? WHERE id = ?`)
        .bind(secondDueAt, now, enrollment.id).run();
      try {
        const schedule = await createRemainingInstallmentSchedule(env, enrollment, enrollment, object.payment_intent, secondDueAt);
        await saveStripeObject(env.ENROLLMENT_DB, enrollment.id, 'subscription_schedule', schedule);
        if (schedule.subscription) {
          const subscriptionId = typeof schedule.subscription === 'string' ? schedule.subscription : schedule.subscription.id;
          if (subscriptionId) await saveStripeReference(env.ENROLLMENT_DB, enrollment.id, 'subscription', subscriptionId, 'active');
        }
        await env.ENROLLMENT_DB.prepare(`UPDATE enrollments SET status = 'schedule_active', next_payment_due_at = ?, updated_at = ? WHERE id = ?`)
          .bind(secondDueAt, now, enrollment.id).run();
      } catch (error) {
        await env.ENROLLMENT_DB.prepare(`UPDATE enrollments SET status = 'attention_required', updated_at = ? WHERE id = ?`)
          .bind(now, enrollment.id).run();
        throw error;
      }
    } else {
      await env.ENROLLMENT_DB.prepare(`UPDATE enrollments SET status = 'paid', next_payment_due_at = NULL, completed_at = ?, updated_at = ? WHERE id = ?`)
        .bind(now, now, enrollment.id).run();
    }
    await env.ENROLLMENT_DB.batch([
      env.ENROLLMENT_DB.prepare(`UPDATE agreements SET status = 'enrolled', updated_at = ? WHERE id = ?`).bind(now, enrollment.agreement_id),
      env.ENROLLMENT_DB.prepare(`UPDATE clients SET lifecycle_status = 'payment_confirmed', updated_at = ? WHERE id = ?`).bind(now, enrollment.client_id),
    ]);
    const activation = await evaluatePortalActivation(env.ENROLLMENT_DB, enrollment.id, now);
    await audit(env.ENROLLMENT_DB, {
      type: 'payment_confirmed', actorType: 'stripe', clientId: enrollment.client_id,
      projectId: enrollment.project_id, agreementId: enrollment.agreement_id,
      enrollmentId: enrollment.id, requestId: requestIdentifier,
      data: { stripeEventId: event.id, installmentNumber: 1 },
    });
    if (activation.changed) await audit(env.ENROLLMENT_DB, {
      type: 'portal_activated', actorType: 'system', clientId: enrollment.client_id,
      projectId: enrollment.project_id, agreementId: enrollment.agreement_id,
      enrollmentId: enrollment.id, requestId: requestIdentifier,
      data: { activationMode: enrollment.activation_mode },
    });
    return;
  }

  if (event.type === 'checkout.session.expired') {
    const enrollmentId = object.metadata?.e4la_enrollment_id || object.client_reference_id;
    if (!enrollmentId) return;
    await env.ENROLLMENT_DB.prepare(`UPDATE enrollments SET status = 'accepted', updated_at = ? WHERE id = ? AND status = 'checkout_pending'`)
      .bind(new Date().toISOString(), enrollmentId).run();
    await env.ENROLLMENT_DB.prepare(`UPDATE payment_installments SET status = 'planned', updated_at = ?
      WHERE enrollment_id = ? AND installment_number = 1 AND status = 'checkout_pending'`)
      .bind(new Date().toISOString(), enrollmentId).run();
    return;
  }

  if (event.type === 'invoice.paid') {
    const enrollment = await findEnrollmentByStripeSubscription(env.ENROLLMENT_DB, stripeSubscriptionId(object));
    if (!enrollment) return;
    const existingInvoice = await env.ENROLLMENT_DB.prepare(`SELECT enrollment_id FROM stripe_objects
      WHERE stripe_object_type = 'invoice' AND stripe_object_id = ? LIMIT 1`).bind(object.id).first();
    if (existingInvoice) {
      if (existingInvoice.enrollment_id !== enrollment.id) throw new Error('Stripe invoice is associated with a different enrollment.');
      return;
    }
    await saveStripeObject(env.ENROLLMENT_DB, enrollment.id, 'invoice', object);
    const installment = await env.ENROLLMENT_DB.prepare(`SELECT id FROM payment_installments
      WHERE enrollment_id = ? AND installment_number > 1 AND status NOT IN ('paid','waived')
      ORDER BY installment_number LIMIT 1`).bind(enrollment.id).first();
    if (installment) {
      await env.ENROLLMENT_DB.prepare(`UPDATE payment_installments SET status = 'paid', stripe_invoice_id = ?, paid_at = ?, updated_at = ? WHERE id = ?`)
        .bind(object.id, new Date().toISOString(), new Date().toISOString(), installment.id).run();
      const next = await env.ENROLLMENT_DB.prepare(`SELECT due_at FROM payment_installments WHERE enrollment_id = ? AND status NOT IN ('paid','waived') ORDER BY installment_number LIMIT 1`)
        .bind(enrollment.id).first();
      await env.ENROLLMENT_DB.prepare(`UPDATE enrollments SET next_payment_due_at = ?, updated_at = ? WHERE id = ?`)
        .bind(next?.due_at || null, new Date().toISOString(), enrollment.id).run();
    }
    await audit(env.ENROLLMENT_DB, {
      type: 'payment_confirmed', actorType: 'stripe', clientId: enrollment.client_id,
      projectId: enrollment.project_id, agreementId: enrollment.agreement_id,
      enrollmentId: enrollment.id, requestId: requestIdentifier,
      data: { stripeEventId: event.id, invoiceId: object.id },
    });
    return;
  }

  if (event.type === 'invoice.payment_failed' || event.type === 'invoice.payment_action_required') {
    const enrollment = await findEnrollmentByStripeSubscription(env.ENROLLMENT_DB, stripeSubscriptionId(object));
    if (!enrollment) return;
    const status = event.type === 'invoice.payment_action_required' ? 'payment_action_required' : 'payment_failed';
    await env.ENROLLMENT_DB.prepare('UPDATE enrollments SET status = ?, updated_at = ? WHERE id = ?')
      .bind(status, new Date().toISOString(), enrollment.id).run();
    await env.ENROLLMENT_DB.prepare(`UPDATE payment_installments SET status = ?, stripe_invoice_id = ?, updated_at = ?
      WHERE id = (SELECT id FROM payment_installments WHERE enrollment_id = ? AND status NOT IN ('paid','waived') ORDER BY installment_number LIMIT 1)`)
      .bind(status === 'payment_action_required' ? 'action_required' : 'failed', object.id, new Date().toISOString(), enrollment.id).run();
    await saveStripeObject(env.ENROLLMENT_DB, enrollment.id, 'invoice', object);
    return;
  }

  if (event.type === 'subscription_schedule.completed') {
    const enrollment = await findEnrollmentByStripeObject(env.ENROLLMENT_DB, 'subscription_schedule', object.id);
    if (!enrollment) return;
    const now = new Date().toISOString();
    const outstanding = await env.ENROLLMENT_DB.prepare(`SELECT COUNT(*) AS count FROM payment_installments
      WHERE enrollment_id = ? AND status NOT IN ('paid','waived')`).bind(enrollment.id).first();
    if (Number(outstanding?.count || 0) === 0) {
      await env.ENROLLMENT_DB.prepare(`UPDATE enrollments SET status = 'paid', next_payment_due_at = NULL, completed_at = ?, updated_at = ? WHERE id = ?`)
        .bind(now, now, enrollment.id).run();
    } else {
      const next = await env.ENROLLMENT_DB.prepare(`SELECT due_at FROM payment_installments
        WHERE enrollment_id = ? AND status NOT IN ('paid','waived') ORDER BY installment_number LIMIT 1`).bind(enrollment.id).first();
      await env.ENROLLMENT_DB.prepare(`UPDATE enrollments SET status = 'attention_required', next_payment_due_at = ?, updated_at = ? WHERE id = ?`)
        .bind(next?.due_at || null, now, enrollment.id).run();
    }
    return;
  }

  if (event.type === 'subscription_schedule.updated' && object.subscription) {
    const enrollment = await findEnrollmentByStripeObject(env.ENROLLMENT_DB, 'subscription_schedule', object.id);
    if (!enrollment) return;
    await saveStripeReference(env.ENROLLMENT_DB, enrollment.id, 'subscription', object.subscription, object.status || 'active');
    return;
  }

  if (event.type === 'subscription_schedule.canceled' || event.type === 'subscription_schedule.aborted') {
    const enrollment = await findEnrollmentByStripeObject(env.ENROLLMENT_DB, 'subscription_schedule', object.id);
    if (!enrollment) return;
    await env.ENROLLMENT_DB.prepare(`UPDATE enrollments SET status = 'attention_required', updated_at = ? WHERE id = ?`)
      .bind(new Date().toISOString(), enrollment.id).run();
  }
}

function stripeSubscriptionId(object) {
  const value = object.subscription || object.parent?.subscription_details?.subscription;
  return typeof value === 'string' ? value : value?.id;
}

async function findEnrollmentByStripeSubscription(db, subscriptionId) {
  if (!subscriptionId) return null;
  return db.prepare(`
    SELECT e.* FROM enrollments e JOIN stripe_objects so ON so.enrollment_id = e.id
    WHERE so.stripe_object_type = 'subscription' AND so.stripe_object_id = ? LIMIT 1
  `).bind(subscriptionId).first();
}

async function findEnrollmentByStripeObject(db, type, id) {
  return db.prepare(`
    SELECT e.* FROM enrollments e JOIN stripe_objects so ON so.enrollment_id = e.id
    WHERE so.stripe_object_type = ? AND so.stripe_object_id = ? LIMIT 1
  `).bind(type, id).first();
}

async function saveStripeReference(db, enrollmentId, type, objectId, status) {
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO stripe_objects (
    id, enrollment_id, stripe_object_type, stripe_object_id, livemode, status, created_at, updated_at
  ) VALUES (?, ?, ?, ?, 0, ?, ?, ?)
  ON CONFLICT(stripe_object_type, stripe_object_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`)
    .bind(crypto.randomUUID(), enrollmentId, type, objectId, status, now, now).run();
}

async function saveStripeObject(db, enrollmentId, type, object) {
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO stripe_objects (
    id, enrollment_id, stripe_object_type, stripe_object_id, livemode, status, metadata_json, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(stripe_object_type, stripe_object_id) DO UPDATE SET status = excluded.status, metadata_json = excluded.metadata_json, updated_at = excluded.updated_at`)
    .bind(crypto.randomUUID(), enrollmentId, type, object.id, object.livemode ? 1 : 0, object.status || null, JSON.stringify(object.metadata || {}), now, now).run();
}
