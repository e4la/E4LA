import {
  HttpError, audit, authenticate, clearSessionCookie, consumeRateLimit, createSession,
  errorResponse, json, operationalLog, randomToken, requestId, requireCsrf, requireFields,
  requireJson, requireTrustedOrigin, rotateSession, sanitizeText, sessionCookie, sha256,
} from '../../_shared/ops-security.js';
import { createBillingPortalSession, createCheckoutSession, stripeRequest } from '../../_shared/stripe.js';
import { verifyCloudflareAccess } from '../../_shared/cloudflare-access.js';
import { validateEnvironmentConfiguration, verifyDatabaseEnvironment } from '../../_shared/environment.js';

export async function onRequest(context) {
  const { request, env } = context;
  try {
    validateEnvironmentConfiguration(env);
    await verifyDatabaseEnvironment(env);
    const route = new URL(request.url).pathname.replace(/^\/api\/ops\/?/, '').replace(/\/$/, '');
    const key = `${request.method.toUpperCase()} ${route}`;
    const handlers = {
      'POST auth/admin': authenticateAdmin,
      'POST auth/client': authenticateClient,
      'POST invites/exchange': exchangeInvite,
      'GET session': refreshSession,
      'POST session/logout': logout,
      'GET agreements/current': currentAgreement,
      'POST agreements/accept': acceptAgreement,
      'POST checkout': startCheckout,
      'GET enrollment/status': enrollmentStatus,
      'POST billing/portal': billingPortal,
      'GET portal': portalData,
      'GET admin/summary': adminSummary,
      'POST admin/clients-projects': createClientProject,
      'POST admin/agreements': createAgreement,
      'POST admin/publication': updatePublication,
    };
    const handler = handlers[key]
      || matchHandler(request.method, route, /^admin\/agreements\/([^/]+)\/invites$/, createAgreementInvite)
      || matchHandler(request.method, route, /^admin\/projects\/([^/]+)\/items$/, createProjectItem)
      || matchHandler(request.method, route, /^admin\/clients\/([^/]+)$/, updateClient, 'PATCH')
      || matchHandler(request.method, route, /^admin\/enrollments\/([^/]+)\/activate$/, activatePortal)
      || matchHandler(request.method, route, /^admin\/preview\/([^/]+)$/, adminPreview, 'GET')
      || matchHandler(request.method, route, /^admin\/projects\/([^/]+)\/phases$/, createPhase)
      || matchHandler(request.method, route, /^admin\/phases\/([^/]+)$/, updatePhase, 'PATCH')
      || matchHandler(request.method, route, /^admin\/projects\/([^/]+)\/progress-snapshots$/, createProgressSnapshot)
      || matchHandler(request.method, route, /^admin\/projects\/([^/]+)\/performance-metrics$/, createPerformanceMetric)
      || matchHandler(request.method, route, /^admin\/performance-metrics\/([^/]+)$/, updatePerformanceMetric, 'PATCH');
    if (!handler) throw new HttpError(404, 'not_found', 'This Client Operations endpoint is unavailable.');
    return await handler(context);
  } catch (error) {
    return errorResponse(error, request);
  }
}

function matchHandler(method, route, pattern, handler, expectedMethod = 'POST') {
  if (method.toUpperCase() !== expectedMethod) return null;
  const match = route.match(pattern);
  return match ? (context) => handler(context, decodeURIComponent(match[1])) : null;
}

async function authenticateAdmin(context) {
  return authenticateIdentity(context, {
    audienceVariable: 'ADMIN_ACCESS_AUD', table: 'admin_users', userType: 'admin_user', actorType: 'admin_user',
    allowedRoles: ['e4la_admin','e4la_collaborator'], eventType: 'admin_authenticated',
  });
}

async function authenticateClient(context) {
  return authenticateIdentity(context, {
    audienceVariable: 'CLIENT_ACCESS_AUD', table: 'client_users', userType: 'client_user', actorType: 'client_user',
    allowedRoles: ['client_owner','authorized_signer','client_viewer'], eventType: 'client_authenticated',
  });
}

async function authenticateIdentity({ request, env }, config) {
  requireTrustedOrigin(request, env);
  requireJson(request);
  validateEnvironmentConfiguration(env, { accessRequired: true, audienceVariable: config.audienceVariable });
  const identity = await verifyCloudflareAccess(request, env, config.audienceVariable);
  await consumeRateLimit(env.ENROLLMENT_DB, `identity:${identity.subjectHash}`, { limit: 12, windowSeconds: 300 });
  const user = await env.ENROLLMENT_DB.prepare(
    `SELECT * FROM ${config.table} WHERE email_normalized = ? AND access_status = 'active' LIMIT 1`,
  ).bind(identity.email).first();
  if (!user || !config.allowedRoles.includes(user.role)) {
    throw new HttpError(403, 'identity_not_authorized', 'This email is not authorized for this E4LA workspace.');
  }
  const now = new Date().toISOString();
  const existing = await env.ENROLLMENT_DB.prepare(`
    SELECT * FROM identity_links WHERE provider = 'cloudflare_access' AND provider_subject_hash = ?
  `).bind(identity.subjectHash).first();
  if (existing && (existing.user_type !== config.userType || existing.user_id !== user.id || existing.revoked_at)) {
    throw new HttpError(403, 'identity_not_authorized', 'This email is not authorized for this E4LA workspace.');
  }
  const identityLinkId = existing?.id || crypto.randomUUID();
  if (existing) {
    await env.ENROLLMENT_DB.prepare('UPDATE identity_links SET email_normalized = ?, last_authenticated_at = ?, updated_at = ? WHERE id = ?')
      .bind(identity.email, now, now, identityLinkId).run();
  } else {
    await env.ENROLLMENT_DB.prepare(`INSERT INTO identity_links (
      id, provider, provider_subject_hash, user_type, user_id, email_normalized,
      last_authenticated_at, created_at, updated_at
    ) VALUES (?, 'cloudflare_access', ?, ?, ?, ?, ?, ?, ?)`)
      .bind(identityLinkId, identity.subjectHash, config.userType, user.id, identity.email, now, now, now).run();
  }
  const session = await createSession(env.ENROLLMENT_DB, {
    actorType: config.actorType, actorId: user.id, clientId: user.client_id || null, role: user.role,
    ttlSeconds: 8 * 60 * 60, identityLinkId, authenticationMethod: 'cloudflare_access',
  });
  await audit(env.ENROLLMENT_DB, {
    type: config.eventType, actorType: config.actorType, actorId: user.id,
    clientId: user.client_id || null, requestId: requestId(request),
  });
  operationalLog(env, { type: config.eventType, requestId: requestId(request), clientId: user.client_id, status: 'succeeded' });
  return json({ role: user.role, csrfToken: session.csrfToken, expiresAt: session.expiresAt }, 200, {
    'Set-Cookie': sessionCookie(session.token, session.ttlSeconds),
  });
}

async function exchangeInvite({ request, env }) {
  requireTrustedOrigin(request, env);
  requireJson(request);
  const body = await request.json();
  const agreementId = sanitizeText(body.agreementId, 80);
  const inviteToken = sanitizeText(body.inviteToken, 180);
  if (!agreementId || !inviteToken) throw new HttpError(404, 'invalid_invite', 'This secure agreement link is invalid or has expired.');
  const inviteHash = await sha256(inviteToken);
  await consumeRateLimit(env.ENROLLMENT_DB, `invite-agreement:${agreementId}`, { limit: 12, windowSeconds: 300 });
  await consumeRateLimit(env.ENROLLMENT_DB, `invite:${inviteHash}`, { limit: 6, windowSeconds: 300 });
  const now = new Date().toISOString();
  const invite = await env.ENROLLMENT_DB.prepare(`
    UPDATE agreement_invites SET consumed_at = ?
    WHERE agreement_id = ? AND token_hash = ? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?
    RETURNING id, agreement_id, agreement_version_id
  `).bind(now, agreementId, inviteHash, now).first();
  if (!invite) throw new HttpError(404, 'invalid_invite', 'This secure agreement link is invalid or has expired.');
  const agreement = await env.ENROLLMENT_DB.prepare(`
    SELECT a.client_id, a.status, a.current_version_id FROM agreements a
    WHERE a.id = ? AND a.current_version_id = ?
  `).bind(invite.agreement_id, invite.agreement_version_id).first();
  if (!agreement || ['accepted','payment_pending','enrolled','completed','void','superseded'].includes(agreement.status)) {
    throw new HttpError(409, 'agreement_unavailable', 'This agreement is no longer available for acceptance. Contact E4LA for help.');
  }
  const session = await createSession(env.ENROLLMENT_DB, {
    actorType: 'agreement_signer', clientId: agreement.client_id,
    agreementId: invite.agreement_id, role: 'agreement_signer', ttlSeconds: 30 * 60,
  });
  await env.ENROLLMENT_DB.prepare(`
    UPDATE agreements SET status = 'viewed', viewed_at = COALESCE(viewed_at, ?), updated_at = ?
    WHERE id = ? AND status IN ('prepared','sent','viewed')
  `).bind(now, now, invite.agreement_id).run();
  await audit(env.ENROLLMENT_DB, {
    type: 'agreement_viewed', actorType: 'agreement_signer', clientId: agreement.client_id,
    agreementId: invite.agreement_id, relatedType: 'agreement_invite', relatedId: invite.id,
    requestId: requestId(request),
  });
  return json({ ok: true, csrfToken: session.csrfToken, expiresAt: session.expiresAt }, 200, {
    'Set-Cookie': sessionCookie(session.token, session.ttlSeconds),
  });
}

async function refreshSession({ request, env }) {
  const current = await authenticate(request, env);
  const next = await rotateSession(env.ENROLLMENT_DB, current);
  return json({
    csrfToken: next.csrfToken, expiresAt: next.expiresAt, role: current.role,
    actorType: current.actor_type, clientId: current.client_id || null,
  }, 200, { 'Set-Cookie': sessionCookie(next.token, next.ttlSeconds) });
}

async function logout({ request, env }) {
  requireTrustedOrigin(request, env);
  requireJson(request);
  const session = await authenticate(request, env);
  await requireCsrf(request, session);
  await env.ENROLLMENT_DB.prepare('UPDATE access_sessions SET revoked_at = ? WHERE id = ?')
    .bind(new Date().toISOString(), session.id).run();
  return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() });
}

async function currentAgreement({ request, env }) {
  const session = await authenticate(request, env, ['agreement_signer']);
  const agreement = await env.ENROLLMENT_DB.prepare(`
    SELECT a.id, a.status, a.program_name, a.expires_at, a.client_id, a.project_id,
      av.id AS version_id, av.version_number, av.legal_document_hash,
      av.rendered_agreement_snapshot, av.agreement_summary_json,
      av.commercial_terms_json, av.acknowledgement_clauses_json,
      c.legal_name, c.display_name, c.billing_email, c.phone, c.billing_address_json,
      p.name AS project_name, p.start_date, p.target_end_date
    FROM agreements a
    JOIN agreement_versions av ON av.id = a.current_version_id
    JOIN clients c ON c.id = a.client_id
    JOIN projects p ON p.id = a.project_id
    WHERE a.id = ? AND a.client_id = ?
  `).bind(session.agreement_id, session.client_id).first();
  if (!agreement) throw new HttpError(404, 'agreement_unavailable', 'This agreement is unavailable.');
  if (agreement.status === 'accepted') throw new HttpError(409, 'agreement_already_completed', 'This agreement has already been accepted.');
  if (agreement.status === 'payment_pending') throw new HttpError(409, 'payment_pending', 'Payment confirmation is pending.');
  if (['enrolled','completed'].includes(agreement.status)) throw new HttpError(409, 'enrollment_confirmed', 'Enrollment is already confirmed.');
  const plans = await env.ENROLLMENT_DB.prepare(`
    SELECT id, plan_code, display_name, total_contract_value, currency, installment_count,
      interval_unit, interval_count, installment_schedule_json
    FROM payment_plans WHERE agreement_version_id = ? AND active = 1 ORDER BY installment_count
  `).bind(agreement.version_id).all();
  return json({
    agreement: {
      id: agreement.id, status: agreement.status, programName: agreement.program_name,
      versionId: agreement.version_id, versionNumber: agreement.version_number,
      legalDocumentHash: agreement.legal_document_hash,
      legalText: agreement.rendered_agreement_snapshot,
      summary: parseJson(agreement.agreement_summary_json, {}),
      terms: parseJson(agreement.commercial_terms_json, {}),
      clauses: parseJson(agreement.acknowledgement_clauses_json, []),
      startDate: agreement.start_date, targetEndDate: agreement.target_end_date,
      expiresAt: agreement.expires_at,
    },
    client: {
      legalBusinessName: agreement.legal_name, dba: agreement.display_name || '',
      email: agreement.billing_email || '', phone: agreement.phone || '',
      billingAddress: parseJson(agreement.billing_address_json, {}), projectName: agreement.project_name,
    },
    paymentPlans: plans.results.map((plan) => ({
      id: plan.id, code: plan.plan_code, name: plan.display_name,
      total: plan.total_contract_value, currency: plan.currency,
      installmentCount: plan.installment_count, intervalUnit: plan.interval_unit,
      intervalCount: plan.interval_count, schedule: parseJson(plan.installment_schedule_json, []),
    })),
  });
}

async function acceptAgreement({ request, env }) {
  requireTrustedOrigin(request, env);
  requireJson(request);
  const session = await authenticate(request, env, ['agreement_signer']);
  await requireCsrf(request, session);
  await consumeRateLimit(env.ENROLLMENT_DB, `accept:${session.token_hash}`, { limit: 4, windowSeconds: 300 });
  const body = await request.json();
  requireFields(body, ['paymentPlanId','signerName','signerRole','signerCompany','typedAcceptance']);
  if (body.authorityConfirmed !== true) throw new HttpError(422, 'authority_required', 'Authority confirmation is required.');
  const clientInfo = body.client || {};
  requireFields(clientInfo, ['legalBusinessName','contactName','email','phone','title','billingAddress','city','state','zip']);
  if (!/^\S+@\S+\.\S+$/.test(clientInfo.email)) throw new HttpError(422, 'validation_error', 'Enter a valid email address.', { fields: ['email'] });
  const agreement = await env.ENROLLMENT_DB.prepare(`
    SELECT a.*, av.legal_document_hash, av.rendered_agreement_snapshot, av.acknowledgement_clauses_json
    FROM agreements a JOIN agreement_versions av ON av.id = a.current_version_id
    WHERE a.id = ? AND a.client_id = ?
  `).bind(session.agreement_id, session.client_id).first();
  if (!agreement || !['prepared','sent','viewed'].includes(agreement.status)) {
    throw new HttpError(409, 'agreement_already_completed', 'This agreement has already been accepted or is unavailable.');
  }
  const plan = await env.ENROLLMENT_DB.prepare(`
    SELECT * FROM payment_plans WHERE id = ? AND agreement_version_id = ? AND active = 1
  `).bind(sanitizeText(body.paymentPlanId, 80), agreement.current_version_id).first();
  if (!plan) throw new HttpError(422, 'payment_plan_invalid', 'Select an available payment schedule.');
  const clauses = parseJson(agreement.acknowledgement_clauses_json, []);
  const requiredClauseIds = clauses.filter((clause) => clause.required !== false).map((clause) => clause.id).sort();
  const acknowledged = Array.isArray(body.acknowledgedClauseIds)
    ? [...new Set(body.acknowledgedClauseIds.map((id) => sanitizeText(id, 80)))].sort() : [];
  const knownClauseIds = clauses.map((clause) => clause.id);
  if (requiredClauseIds.some((id) => !acknowledged.includes(id)) || acknowledged.some((id) => !knownClauseIds.includes(id))) {
    throw new HttpError(422, 'acknowledgements_incomplete', 'Review and accept every required agreement acknowledgment.');
  }
  const schedule = buildSchedule(parseJson(plan.installment_schedule_json, []), new Date());
  if (schedule.length !== Number(plan.installment_count) || schedule.reduce((sum, item) => sum + item.amount, 0) !== Number(plan.total_contract_value)) {
    throw new HttpError(503, 'payment_plan_misconfigured', 'This payment schedule is unavailable. Contact E4LA for assistance.');
  }
  const normalizedSigner = (value) => sanitizeText(value, 160).replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
  if (normalizedSigner(body.signerName) !== normalizedSigner(body.typedAcceptance)) {
    throw new HttpError(422, 'signature_mismatch', 'Your electronic signature must match your full legal name.', { fields: ['typedAcceptance'] });
  }
  const now = new Date().toISOString();
  const acceptanceId = crypto.randomUUID();
  const enrollmentId = crypto.randomUUID();
  const clientUserId = crypto.randomUUID();
  const address = JSON.stringify({
    line1: sanitizeText(clientInfo.billingAddress, 180), city: sanitizeText(clientInfo.city, 80),
    state: sanitizeText(clientInfo.state, 40), zip: sanitizeText(clientInfo.zip, 20),
  });
  const acceptanceStatements = [
    env.ENROLLMENT_DB.prepare(`UPDATE clients SET legal_name = ?, display_name = ?, billing_email = ?, phone = ?, billing_address_json = ?, lifecycle_status = 'agreement_accepted', updated_at = ? WHERE id = ?`)
      .bind(sanitizeText(clientInfo.legalBusinessName, 180), sanitizeText(clientInfo.dba, 180) || null,
        sanitizeText(clientInfo.email, 180).toLowerCase(), sanitizeText(clientInfo.phone, 40), address, now, agreement.client_id),
    env.ENROLLMENT_DB.prepare(`INSERT INTO client_users (id, client_id, email_normalized, full_name, title, role, access_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'authorized_signer', 'invited', ?, ?)
      ON CONFLICT(client_id, email_normalized) DO UPDATE SET full_name = excluded.full_name, title = excluded.title, updated_at = excluded.updated_at`)
      .bind(clientUserId, agreement.client_id, sanitizeText(clientInfo.email, 180).toLowerCase(), sanitizeText(clientInfo.contactName, 160), sanitizeText(clientInfo.title, 100), now, now),
    env.ENROLLMENT_DB.prepare(`INSERT INTO agreement_acceptances (
      id, agreement_id, agreement_version_id, client_id, project_id, payment_plan_id,
      legal_document_hash, rendered_agreement_snapshot, total_contract_value,
      installment_amounts_json, installment_dates_json, acknowledged_clause_ids_json,
      authorized_signer_name, authorized_signer_role, signer_company, typed_acceptance,
      authority_confirmed, accepted_at_utc, request_id, user_agent, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`)
      .bind(acceptanceId, agreement.id, agreement.current_version_id, agreement.client_id, agreement.project_id, plan.id,
        agreement.legal_document_hash, agreement.rendered_agreement_snapshot, plan.total_contract_value,
        JSON.stringify(schedule.map((entry) => entry.amount)), JSON.stringify(schedule.map((entry) => entry.dueAt)), JSON.stringify(acknowledged),
        sanitizeText(body.signerName, 160), sanitizeText(body.signerRole, 100), sanitizeText(body.signerCompany, 180),
        sanitizeText(body.typedAcceptance, 160), now, requestId(request), sanitizeText(request.headers.get('User-Agent') || '', 320), now),
    env.ENROLLMENT_DB.prepare(`INSERT INTO enrollments (
      id, client_id, project_id, agreement_id, acceptance_id, payment_plan_id, status,
      next_payment_due_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'accepted', ?, ?, ?)`)
      .bind(enrollmentId, agreement.client_id, agreement.project_id, agreement.id, acceptanceId, plan.id, schedule[0]?.dueAt || null, now, now),
    env.ENROLLMENT_DB.prepare(`UPDATE agreements SET status = 'accepted', accepted_version_id = current_version_id, accepted_at = ?, updated_at = ? WHERE id = ?`)
      .bind(now, now, agreement.id),
    env.ENROLLMENT_DB.prepare(`INSERT INTO audit_events (
      id, event_type, actor_type, client_id, project_id, agreement_id, enrollment_id,
      related_entity_type, related_entity_id, request_id, event_data_json, created_at
    ) VALUES (?, 'agreement_accepted', 'agreement_signer', ?, ?, ?, ?, 'agreement_acceptance', ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), agreement.client_id, agreement.project_id, agreement.id, enrollmentId, acceptanceId, requestId(request),
        JSON.stringify({ paymentPlanId: plan.id, clauseIds: acknowledged }), now),
  ];
  schedule.forEach((installment) => {
    acceptanceStatements.push(env.ENROLLMENT_DB.prepare(`INSERT INTO payment_installments (
      id, enrollment_id, installment_number, amount, currency, due_at, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'planned', ?, ?)`)
      .bind(crypto.randomUUID(), enrollmentId, installment.number, installment.amount, plan.currency, installment.dueAt, now, now));
  });
  await env.ENROLLMENT_DB.batch(acceptanceStatements);
  return json({ accepted: true, agreementId: agreement.id, enrollmentId, acceptedAt: now });
}

async function startCheckout({ request, env }) {
  requireTrustedOrigin(request, env);
  requireJson(request);
  validateEnvironmentConfiguration(env, { stripeRequired: true });
  const session = await authenticate(request, env, ['agreement_signer','client_owner','authorized_signer']);
  await requireCsrf(request, session);
  await consumeRateLimit(env.ENROLLMENT_DB, `checkout:${session.token_hash}`, { limit: 5, windowSeconds: 300 });
  const record = await env.ENROLLMENT_DB.prepare(`
    SELECT e.*, pp.*, c.legal_name, c.billing_email
    FROM enrollments e JOIN payment_plans pp ON pp.id = e.payment_plan_id
    JOIN clients c ON c.id = e.client_id
    WHERE e.agreement_id = ? AND e.client_id = ?
  `).bind(session.agreement_id, session.client_id).first();
  if (!record) throw new HttpError(409, 'acceptance_required', 'Accept the agreement before continuing to payment.');
  if (!['accepted','checkout_pending','payment_failed'].includes(record.status)) {
    throw new HttpError(409, 'checkout_unavailable', 'Payment setup is already processing or complete.');
  }
  if (!record.stripe_initial_price_id) throw new HttpError(503, 'stripe_plan_incomplete', 'This payment schedule is not connected to a Stripe test Price yet.');
  let customer = await env.ENROLLMENT_DB.prepare(`
    SELECT stripe_object_id FROM stripe_objects WHERE enrollment_id = ? AND stripe_object_type = 'customer' ORDER BY created_at DESC LIMIT 1
  `).bind(record.id).first();
  if (!customer) {
    const created = await stripeRequest(env, 'POST', '/customers', {
      name: record.legal_name, email: record.billing_email,
      metadata: { e4la_client_id: record.client_id, e4la_enrollment_id: record.id },
    }, `customer:${record.client_id}`);
    customer = { stripe_object_id: created.id };
    await saveStripeObject(env.ENROLLMENT_DB, record.id, 'customer', created);
  }
  const agreementPath = `/client-agreement/${encodeURIComponent(record.agreement_id)}`;
  const checkout = await createCheckoutSession(env, record, record, customer.stripe_object_id, agreementPath);
  await env.ENROLLMENT_DB.batch([
    stripeObjectStatement(env.ENROLLMENT_DB, record.id, 'checkout_session', checkout),
    env.ENROLLMENT_DB.prepare(`UPDATE enrollments SET status = 'checkout_pending', updated_at = ? WHERE id = ?`)
      .bind(new Date().toISOString(), record.id),
    env.ENROLLMENT_DB.prepare(`UPDATE agreements SET status = 'payment_pending', updated_at = ? WHERE id = ?`)
      .bind(new Date().toISOString(), record.agreement_id),
    env.ENROLLMENT_DB.prepare(`UPDATE clients SET lifecycle_status = 'payment_initiated', updated_at = ? WHERE id = ?`)
      .bind(new Date().toISOString(), record.client_id),
    env.ENROLLMENT_DB.prepare(`UPDATE payment_installments SET status = 'checkout_pending', updated_at = ? WHERE enrollment_id = ? AND installment_number = 1 AND status IN ('planned','failed')`)
      .bind(new Date().toISOString(), record.id),
    auditStatement(env.ENROLLMENT_DB, 'checkout_created', record, requestId(request), { checkoutSessionId: checkout.id }),
  ]);
  return json({ checkoutUrl: checkout.url, expiresAt: new Date(checkout.expires_at * 1000).toISOString() });
}

async function enrollmentStatus({ request, env }) {
  const session = await authenticate(request, env);
  const row = await env.ENROLLMENT_DB.prepare(`
    SELECT id, status, next_payment_due_at, activated_at, completed_at, updated_at
    FROM enrollments WHERE client_id = ? AND (? IS NULL OR agreement_id = ?)
    ORDER BY created_at DESC LIMIT 1
  `).bind(session.client_id, session.agreement_id, session.agreement_id).first();
  if (!row) throw new HttpError(404, 'enrollment_not_found', 'No enrollment was found for this secure session.');
  return json({ enrollment: row });
}

async function billingPortal({ request, env }) {
  requireTrustedOrigin(request, env);
  requireJson(request);
  validateEnvironmentConfiguration(env, { stripeRequired: true });
  const session = await authenticate(request, env, ['client_owner','authorized_signer']);
  await requireCsrf(request, session);
  await consumeRateLimit(env.ENROLLMENT_DB, `billing-portal:${session.token_hash}`, { limit: 5, windowSeconds: 300 });
  const customer = await env.ENROLLMENT_DB.prepare(`
    SELECT so.stripe_object_id, so.enrollment_id FROM stripe_objects so
    JOIN enrollments e ON e.id = so.enrollment_id
    WHERE e.client_id = ? AND so.stripe_object_type = 'customer'
    ORDER BY so.created_at DESC LIMIT 1
  `).bind(session.client_id).first();
  if (!customer) throw new HttpError(404, 'billing_profile_unavailable', 'A billing profile is not available yet.');
  const portal = await createBillingPortalSession(env, customer.stripe_object_id, '/client-portal/');
  await saveStripeObject(env.ENROLLMENT_DB, customer.enrollment_id, 'portal_session', portal);
  await audit(env.ENROLLMENT_DB, { type: 'billing_portal_opened', actorType: 'client_user', actorId: session.actor_id, clientId: session.client_id, requestId: requestId(request) });
  return json({ portalUrl: portal.url });
}

async function portalData({ request, env }) {
  const session = await authenticate(request, env, ['client_owner','authorized_signer','client_viewer']);
  const activation = await env.ENROLLMENT_DB.prepare(`
    SELECT id, portal_activated_at, portal_deactivated_at FROM enrollments
    WHERE client_id = ? ORDER BY created_at DESC LIMIT 1
  `).bind(session.client_id).first();
  if (!activation?.portal_activated_at || activation.portal_deactivated_at) {
    throw new HttpError(403, 'portal_not_active', 'Your E4LA portal is not active yet. Contact E4LA if you need help.');
  }
  return json(await loadPortalData(env.ENROLLMENT_DB, session.client_id));
}

async function loadPortalData(db, clientId) {
  const client = await db.prepare(`SELECT id, legal_name, display_name FROM clients WHERE id = ? AND archived_at IS NULL`).bind(clientId).first();
  const project = await db.prepare(`
    SELECT * FROM projects WHERE client_id = ? AND client_visible = 1 AND status != 'archived' ORDER BY created_at DESC LIMIT 1
  `).bind(clientId).first();
  if (!project) {
    return {
      client, project: null, milestones: [], updates: [], deliverables: [], documents: [], agreements: [], enrollment: null,
      progress: emptyProgressSummary(), roadmap: [], weeklyProgress: [], performanceMetrics: [],
    };
  }
  const [milestones, updates, deliverables, documents, agreements, enrollment, phases, snapshots, metrics] = await db.batch([
    db.prepare(`SELECT id, title, description, status, target_date, completed_at, phase_id FROM project_milestones WHERE project_id = ? AND publication_status = 'published' ORDER BY sort_order, target_date`).bind(project.id),
    db.prepare(`SELECT id, title, body, update_type, published_at FROM project_updates WHERE project_id = ? AND publication_status = 'published' ORDER BY published_at DESC`).bind(project.id),
    db.prepare(`SELECT id, title, description, deliverable_type, external_url, published_at, completed_at FROM deliverables WHERE project_id = ? AND publication_status = 'published' ORDER BY published_at DESC`).bind(project.id),
    db.prepare(`SELECT id, title, document_type, external_url, published_at FROM portal_documents WHERE client_id = ? AND publication_status = 'published' ORDER BY published_at DESC`).bind(clientId),
    db.prepare(`SELECT a.id, a.program_name, a.status, a.accepted_at, av.version_number FROM agreements a LEFT JOIN agreement_versions av ON av.id = a.accepted_version_id WHERE a.client_id = ? AND a.status IN ('accepted','payment_pending','enrolled','completed') ORDER BY a.accepted_at DESC`).bind(clientId),
    db.prepare(`SELECT e.id, e.status, e.next_payment_due_at, e.activated_at, e.completed_at,
      e.activation_mode, e.onboarding_ready, e.portal_activated_at,
      pp.display_name AS payment_plan_name, aa.total_contract_value, aa.installment_amounts_json,
      aa.installment_dates_json,
      COALESCE((SELECT SUM(pi.amount) FROM payment_installments pi WHERE pi.enrollment_id = e.id AND pi.status = 'paid'), 0) AS paid_amount,
      COALESCE((SELECT COUNT(*) FROM payment_installments pi WHERE pi.enrollment_id = e.id AND pi.status = 'paid'), 0) AS completed_payments,
      (SELECT pi.amount FROM payment_installments pi WHERE pi.enrollment_id = e.id AND pi.status != 'paid' ORDER BY pi.installment_number LIMIT 1) AS next_amount
      FROM enrollments e JOIN payment_plans pp ON pp.id = e.payment_plan_id
      JOIN agreement_acceptances aa ON aa.id = e.acceptance_id
      WHERE e.client_id = ? ORDER BY e.created_at DESC LIMIT 1`).bind(clientId),
    db.prepare(`SELECT id, name, sequence, status, target_start_date, target_end_date, client_action_required, client_action_note FROM project_phases WHERE project_id = ? AND publication_status = 'published' ORDER BY sequence`).bind(project.id),
    db.prepare(`SELECT week_number, snapshot_date, completed_milestones_count, total_milestones_count FROM project_progress_snapshots WHERE project_id = ? AND publication_status = 'published' ORDER BY week_number`).bind(project.id),
    db.prepare(`SELECT metric_key, label, category, current_value, baseline_value, trend, interpretation FROM project_performance_metrics WHERE project_id = ? AND publication_status = 'published' ORDER BY sort_order`).bind(project.id),
  ]);
  const publishedMilestones = milestones.results;
  const publishedPhases = phases.results;
  const roadmap = publishedPhases.map((phase) => {
    const phaseMilestones = publishedMilestones.filter((item) => item.phase_id === phase.id);
    return {
      id: phase.id, name: phase.name, sequence: phase.sequence, status: phase.status,
      milestoneCount: phaseMilestones.length,
      completedMilestoneCount: phaseMilestones.filter((item) => item.status === 'completed').length,
      targetStartDate: phase.target_start_date, targetEndDate: phase.target_end_date,
      clientActionRequired: Boolean(phase.client_action_required), clientActionNote: phase.client_action_note,
    };
  });
  const weeklyProgress = snapshots.results.map((row) => ({
    weekNumber: row.week_number, snapshotDate: row.snapshot_date,
    completedMilestones: row.completed_milestones_count, totalMilestones: row.total_milestones_count,
    percentComplete: row.total_milestones_count > 0 ? Math.round((row.completed_milestones_count / row.total_milestones_count) * 100) : null,
  }));
  const performanceMetrics = metrics.results.map((row) => ({
    metricKey: row.metric_key, label: row.label, category: row.category,
    currentValue: row.current_value, baselineValue: row.baseline_value, trend: row.trend, interpretation: row.interpretation,
  }));
  const progress = computeProgressSummary(project, publishedPhases, publishedMilestones, updates.results);
  return {
    client, project, milestones: publishedMilestones, updates: updates.results, deliverables: deliverables.results,
    documents: documents.results, agreements: agreements.results, enrollment: enrollment.results[0] || null,
    progress, roadmap, weeklyProgress, performanceMetrics,
  };
}

function emptyProgressSummary() {
  return { percentComplete: null, qualitativeState: 'In progress', currentPhaseName: null, completedPhaseCount: 0, totalPhaseCount: 0, nextPhaseName: null, remainingMilestoneCount: 0, statusLabel: 'On Track' };
}

function computeProgressSummary(project, phases, milestones, updates) {
  const totalMilestones = milestones.length;
  const completedMilestones = milestones.filter((item) => item.status === 'completed').length;
  const percentComplete = totalMilestones > 0 ? Math.round((completedMilestones / totalMilestones) * 100) : null;
  let qualitativeState = 'In progress';
  if (project.status === 'completed' || percentComplete === 100) qualitativeState = 'Complete';
  else if (percentComplete === null) qualitativeState = phases.length === 0 ? 'Not started yet' : 'In progress';
  else if (percentComplete < 25) qualitativeState = 'Getting started';
  else if (percentComplete < 75) qualitativeState = 'Underway';
  else qualitativeState = 'Nearly complete';
  const currentPhase = phases.find((phase) => phase.status === 'current');
  const currentIndex = currentPhase ? phases.findIndex((phase) => phase.id === currentPhase.id) : -1;
  const nextPhase = currentIndex >= 0 ? phases[currentIndex + 1] : phases.find((phase) => phase.status === 'upcoming');
  const hasClientActionPhase = phases.some((phase) => phase.client_action_required);
  const hasClientRequestUpdate = updates.some((item) => item.update_type === 'client_request');
  const statusLabel = project.status === 'completed' ? 'Completed' : (hasClientActionPhase || hasClientRequestUpdate) ? 'Needs Attention' : 'On Track';
  return {
    percentComplete, qualitativeState,
    currentPhaseName: currentPhase?.name || null,
    completedPhaseCount: phases.filter((phase) => phase.status === 'completed').length,
    totalPhaseCount: phases.length,
    nextPhaseName: nextPhase?.name || null,
    remainingMilestoneCount: milestones.filter((item) => !['completed','cancelled'].includes(item.status)).length,
    statusLabel,
  };
}

async function adminSummary({ request, env }) {
  const session = await authenticate(request, env, ['e4la_admin','e4la_collaborator']);
  const isAdmin = session.role === 'e4la_admin';
  const clientStatement = isAdmin
    ? env.ENROLLMENT_DB.prepare(`SELECT id, display_name, legal_name, billing_email, phone, lifecycle_status, updated_at FROM clients ORDER BY updated_at DESC LIMIT 50`)
    : env.ENROLLMENT_DB.prepare(`SELECT DISTINCT c.id, c.display_name, c.legal_name, c.billing_email, c.phone, c.lifecycle_status, c.updated_at
        FROM clients c JOIN projects p ON p.client_id = c.id JOIN admin_project_access apa ON apa.project_id = p.id
        WHERE apa.admin_user_id = ? ORDER BY c.updated_at DESC LIMIT 50`).bind(session.actor_id);
  const agreementStatement = isAdmin
    ? env.ENROLLMENT_DB.prepare(`SELECT id, client_id, program_name, status, expires_at, updated_at FROM agreements ORDER BY updated_at DESC LIMIT 50`)
    : env.ENROLLMENT_DB.prepare(`SELECT a.id, a.client_id, a.program_name, a.status, a.expires_at, a.updated_at
        FROM agreements a JOIN admin_project_access apa ON apa.project_id = a.project_id
        WHERE apa.admin_user_id = ? ORDER BY a.updated_at DESC LIMIT 50`).bind(session.actor_id);
  const projectStatement = isAdmin
    ? env.ENROLLMENT_DB.prepare(`SELECT id, client_id, name, status, current_phase, target_end_date FROM projects ORDER BY updated_at DESC LIMIT 50`)
    : env.ENROLLMENT_DB.prepare(`SELECT p.id, p.client_id, p.name, p.status, p.current_phase, p.target_end_date
        FROM projects p JOIN admin_project_access apa ON apa.project_id = p.id
        WHERE apa.admin_user_id = ? ORDER BY p.updated_at DESC LIMIT 50`).bind(session.actor_id);
  const enrollmentStatement = isAdmin
    ? env.ENROLLMENT_DB.prepare(`SELECT e.id, e.client_id, e.project_id, e.agreement_id, e.status, e.next_payment_due_at,
        e.activation_mode, e.onboarding_ready, e.portal_activated_at, pp.display_name AS payment_plan_name,
        aa.total_contract_value,
        COALESCE((SELECT SUM(pi.amount) FROM payment_installments pi WHERE pi.enrollment_id = e.id AND pi.status = 'paid'), 0) AS paid_amount
        FROM enrollments e JOIN payment_plans pp ON pp.id = e.payment_plan_id
        JOIN agreement_acceptances aa ON aa.id = e.acceptance_id ORDER BY e.updated_at DESC LIMIT 50`)
    : env.ENROLLMENT_DB.prepare(`SELECT e.id, e.client_id, e.project_id, e.agreement_id, e.status, e.next_payment_due_at,
        e.activation_mode, e.onboarding_ready, e.portal_activated_at, pp.display_name AS payment_plan_name,
        aa.total_contract_value,
        COALESCE((SELECT SUM(pi.amount) FROM payment_installments pi WHERE pi.enrollment_id = e.id AND pi.status = 'paid'), 0) AS paid_amount
        FROM enrollments e JOIN admin_project_access apa ON apa.project_id = e.project_id
        JOIN payment_plans pp ON pp.id = e.payment_plan_id JOIN agreement_acceptances aa ON aa.id = e.acceptance_id
        WHERE apa.admin_user_id = ? ORDER BY e.updated_at DESC LIMIT 50`).bind(session.actor_id);
  const activityStatement = isAdmin
    ? env.ENROLLMENT_DB.prepare(`SELECT ae.event_type, ae.client_id, ae.created_at, c.display_name AS client_name
        FROM audit_events ae LEFT JOIN clients c ON c.id = ae.client_id ORDER BY ae.created_at DESC LIMIT 30`)
    : env.ENROLLMENT_DB.prepare(`SELECT DISTINCT ae.event_type, ae.client_id, ae.created_at, c.display_name AS client_name
        FROM audit_events ae JOIN projects p ON p.id = ae.project_id JOIN admin_project_access apa ON apa.project_id = p.id
        LEFT JOIN clients c ON c.id = ae.client_id WHERE apa.admin_user_id = ? ORDER BY ae.created_at DESC LIMIT 30`).bind(session.actor_id);
  const milestoneStatement = isAdmin
    ? env.ENROLLMENT_DB.prepare(`SELECT pm.title, pm.target_date, c.display_name AS client_name FROM project_milestones pm JOIN projects p ON p.id = pm.project_id JOIN clients c ON c.id = p.client_id WHERE pm.status IN ('planned','in_progress') ORDER BY pm.target_date LIMIT 20`)
    : env.ENROLLMENT_DB.prepare(`SELECT pm.title, pm.target_date, c.display_name AS client_name FROM project_milestones pm JOIN projects p ON p.id = pm.project_id JOIN clients c ON c.id = p.client_id JOIN admin_project_access apa ON apa.project_id = p.id WHERE apa.admin_user_id = ? AND pm.status IN ('planned','in_progress') ORDER BY pm.target_date LIMIT 20`).bind(session.actor_id);
  const [clients, agreements, projects, enrollments, activity, milestones] = await env.ENROLLMENT_DB.batch([
    clientStatement, agreementStatement, projectStatement, enrollmentStatement, activityStatement, milestoneStatement,
  ]);
  return json({ clients: clients.results, agreements: agreements.results, projects: projects.results,
    enrollments: enrollments.results, activity: activity.results, milestones: milestones.results,
    previewModeLabel: 'Admin Preview' });
}

async function createClientProject({ request, env }) {
  requireTrustedOrigin(request, env); requireJson(request);
  const session = await authenticate(request, env, ['e4la_admin']);
  await requireCsrf(request, session);
  const body = await request.json();
  requireFields(body, ['legalName','displayName','ownerEmail','ownerName','projectName']);
  const email = sanitizeText(body.ownerEmail, 254).toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(422, 'validation_error', 'Enter a valid authorized owner email.', { fields: ['ownerEmail'] });
  const now = new Date().toISOString();
  const clientId = opaqueId('clt');
  const projectId = opaqueId('prj');
  const clientUserId = opaqueId('usr');
  await env.ENROLLMENT_DB.batch([
    env.ENROLLMENT_DB.prepare(`INSERT INTO clients (id, lifecycle_status, legal_name, display_name, billing_email, created_at, updated_at)
      VALUES (?, 'qualified', ?, ?, ?, ?, ?)`)
      .bind(clientId, sanitizeText(body.legalName, 180), sanitizeText(body.displayName, 180), email, now, now),
    env.ENROLLMENT_DB.prepare(`INSERT INTO client_users (id, client_id, email_normalized, full_name, title, role, access_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'client_owner', 'invited', ?, ?)`)
      .bind(clientUserId, clientId, email, sanitizeText(body.ownerName, 160), sanitizeText(body.ownerTitle, 100) || null, now, now),
    env.ENROLLMENT_DB.prepare(`INSERT INTO projects (id, client_id, name, status, current_phase, start_date, target_end_date, summary, client_visible, created_at, updated_at)
      VALUES (?, ?, ?, 'planned', 'Agreement preparation', ?, ?, ?, 0, ?, ?)`)
      .bind(projectId, clientId, sanitizeText(body.projectName, 180), sanitizeDate(body.startDate), sanitizeDate(body.targetEndDate), sanitizeText(body.projectSummary, 1200) || null, now, now),
    auditStatementForAdmin(env.ENROLLMENT_DB, 'client_created', session, requestId(request), { clientId, projectId }),
  ]);
  operationalLog(env, { type: 'client_created', requestId: requestId(request), clientId, projectId, status: 'succeeded' });
  return json({ clientId, projectId, ownerUserId: clientUserId }, 201);
}

async function updateClient({ request, env }, clientId) {
  requireTrustedOrigin(request, env); requireJson(request);
  const session = await authenticate(request, env, ['e4la_admin']);
  await requireCsrf(request, session);
  const body = await request.json();
  requireFields(body, ['legalName','displayName','billingEmail','lifecycleStatus']);
  const lifecycle = sanitizeText(body.lifecycleStatus, 40);
  const allowedLifecycle = new Set(['prospect','qualified','agreement_prepared','agreement_sent','agreement_viewed','agreement_accepted','payment_initiated','payment_confirmed','active','project_active','work_in_progress','reporting','completed','ongoing','retainer','archived']);
  if (!allowedLifecycle.has(lifecycle)) throw new HttpError(422, 'validation_error', 'Select a supported client lifecycle state.');
  const email = sanitizeText(body.billingEmail, 254).toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(422, 'validation_error', 'Enter a valid billing email.', { fields: ['billingEmail'] });
  const client = await env.ENROLLMENT_DB.prepare('SELECT id FROM clients WHERE id = ?').bind(sanitizeText(clientId, 80)).first();
  if (!client) throw new HttpError(404, 'client_not_found', 'The client record is unavailable.');
  const now = new Date().toISOString();
  await env.ENROLLMENT_DB.batch([
    env.ENROLLMENT_DB.prepare(`UPDATE clients SET legal_name = ?, display_name = ?, billing_email = ?, phone = ?, lifecycle_status = ?,
      archived_at = CASE WHEN ? = 'archived' THEN COALESCE(archived_at, ?) ELSE NULL END, updated_at = ? WHERE id = ?`)
      .bind(sanitizeText(body.legalName, 180), sanitizeText(body.displayName, 180), email, sanitizeText(body.phone, 40) || null, lifecycle, lifecycle, now, now, client.id),
    auditStatementForAdmin(env.ENROLLMENT_DB, lifecycle === 'archived' ? 'client_archived' : 'client_updated', session, requestId(request), { clientId: client.id }),
  ]);
  return json({ id: client.id, lifecycleStatus: lifecycle, updatedAt: now });
}

async function createAgreement({ request, env }) {
  requireTrustedOrigin(request, env); requireJson(request);
  const session = await authenticate(request, env, ['e4la_admin']);
  await requireCsrf(request, session);
  const body = await request.json();
  requireFields(body, ['clientId','projectId','programName','startDate']);
  const total = Number(body.totalProgramFee);
  const structures = Array.isArray(body.paymentStructures) ? [...new Set(body.paymentStructures)] : [];
  if (!Number.isSafeInteger(total) || total <= 0) throw new HttpError(422, 'commercial_terms_invalid', 'Enter the total program fee in cents.');
  if (!structures.length || structures.some((value) => !['pay_full','three_monthly','six_biweekly'].includes(value))) {
    throw new HttpError(422, 'payment_plan_invalid', 'Select only approved fixed-program payment schedules.');
  }
  const project = await env.ENROLLMENT_DB.prepare('SELECT * FROM projects WHERE id = ? AND client_id = ?')
    .bind(sanitizeText(body.projectId, 80), sanitizeText(body.clientId, 80)).first();
  if (!project) throw new HttpError(404, 'client_project_not_found', 'The selected client project is unavailable.');
  const agreementId = opaqueId('agr');
  const versionId = opaqueId('agrv');
  const now = new Date().toISOString();
  const clauses = standardAcknowledgements();
  const snapshot = phaseCLegalPlaceholder(body.programName, body.startDate, total);
  const legalHash = await sha256(snapshot);
  const plans = structures.map((code) => buildApprovedPlan(code, total, versionId, now));
  await env.ENROLLMENT_DB.batch([
    env.ENROLLMENT_DB.prepare(`INSERT INTO agreements (
      id, client_id, project_id, status, program_name, current_version_id, expires_at, created_at, updated_at
    ) VALUES (?, ?, ?, 'prepared', ?, ?, ?, ?, ?)`)
      .bind(agreementId, project.client_id, project.id, sanitizeText(body.programName, 180), versionId, sanitizeTimestamp(body.expiresAt), now, now),
    env.ENROLLMENT_DB.prepare(`INSERT INTO agreement_versions (
      id, agreement_id, version_number, legal_document_hash, rendered_agreement_snapshot,
      agreement_summary_json, commercial_terms_json, acknowledgement_clauses_json,
      created_by_admin_id, created_at
    ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(versionId, agreementId, legalHash, snapshot,
        JSON.stringify({ initialTerm: '90 Days', totalInvestment: total, startDate: sanitizeDate(body.startDate) }),
        JSON.stringify({ currency: 'usd', programType: 'fixed_program', legalStatus: 'phase_c_placeholder' }),
        JSON.stringify(clauses), session.actor_id, now),
    ...plans.map((plan) => env.ENROLLMENT_DB.prepare(`INSERT INTO payment_plans (
      id, agreement_version_id, plan_code, display_name, total_contract_value, currency,
      installment_count, interval_unit, interval_count, installment_schedule_json, active, created_at
    ) VALUES (?, ?, ?, ?, ?, 'usd', ?, ?, ?, ?, 1, ?)`)
      .bind(plan.id, versionId, plan.code, plan.name, total, plan.count, plan.unit, plan.interval, JSON.stringify(plan.schedule), now)),
    env.ENROLLMENT_DB.prepare(`UPDATE clients SET lifecycle_status = 'agreement_prepared', updated_at = ? WHERE id = ?`).bind(now, project.client_id),
    auditStatementForAdmin(env.ENROLLMENT_DB, 'agreement_created', session, requestId(request), { clientId: project.client_id, projectId: project.id, agreementId }),
    auditStatementForAdmin(env.ENROLLMENT_DB, 'agreement_version_created', session, requestId(request), { clientId: project.client_id, projectId: project.id, agreementId, versionId }),
  ]);
  return json({ agreementId, agreementVersionId: versionId, versionNumber: 1, legalDocumentHash: legalHash, legalStatus: 'phase_c_placeholder' }, 201);
}

async function createAgreementInvite({ request, env }, agreementId) {
  requireTrustedOrigin(request, env); requireJson(request);
  const session = await authenticate(request, env, ['e4la_admin']);
  await requireCsrf(request, session);
  const body = await request.json();
  const agreement = await env.ENROLLMENT_DB.prepare(`SELECT a.*, c.billing_email, av.commercial_terms_json FROM agreements a JOIN clients c ON c.id = a.client_id JOIN agreement_versions av ON av.id = a.current_version_id WHERE a.id = ?`)
    .bind(sanitizeText(agreementId, 80)).first();
  if (!agreement || !['prepared','sent','viewed'].includes(agreement.status)) throw new HttpError(409, 'agreement_invite_unavailable', 'A secure invitation cannot be created for this agreement.');
  if (parseJson(agreement.commercial_terms_json, {}).legalStatus !== 'approved') throw new HttpError(409, 'agreement_legal_unapproved', 'This agreement version uses placeholder legal language and cannot be sent to a client until E4LA approves the final legal text.');
  const token = randomToken(32);
  const inviteId = opaqueId('inv');
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + Math.min(Math.max(Number(body.expiresInHours) || 72, 1), 168) * 3600 * 1000).toISOString();
  await env.ENROLLMENT_DB.batch([
    env.ENROLLMENT_DB.prepare(`INSERT INTO agreement_invites (
      id, agreement_id, agreement_version_id, intended_email_normalized, token_hash,
      expires_at, created_by_admin_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(inviteId, agreement.id, agreement.current_version_id, agreement.billing_email, await sha256(token), expiresAt, session.actor_id, now),
    env.ENROLLMENT_DB.prepare(`UPDATE agreements SET status = 'sent', sent_at = COALESCE(sent_at, ?), updated_at = ? WHERE id = ?`).bind(now, now, agreement.id),
    env.ENROLLMENT_DB.prepare(`UPDATE clients SET lifecycle_status = 'agreement_sent', updated_at = ? WHERE id = ?`).bind(now, agreement.client_id),
    auditStatementForAdmin(env.ENROLLMENT_DB, 'agreement_sent', session, requestId(request), { clientId: agreement.client_id, projectId: agreement.project_id, agreementId: agreement.id, inviteId }),
  ]);
  const origin = String(env.PUBLIC_SITE_URL).replace(/\/$/, '');
  return json({
    inviteId, expiresAt, delivery: 'preview_only_inert',
    invitationUrl: `${origin}/client-agreement/${encodeURIComponent(agreement.id)}#invite=${token}`,
  }, 201);
}

async function activatePortal({ request, env }, enrollmentId) {
  requireTrustedOrigin(request, env); requireJson(request);
  const session = await authenticate(request, env, ['e4la_admin']);
  await requireCsrf(request, session);
  const body = await request.json();
  const mode = sanitizeText(body.activationMode, 20) || 'manual';
  if (!['automatic','manual','scheduled'].includes(mode)) throw new HttpError(422, 'activation_policy_invalid', 'Select a supported portal activation policy.');
  const enrollment = await env.ENROLLMENT_DB.prepare(`SELECT e.*, pi.status AS initial_payment_status FROM enrollments e JOIN payment_installments pi ON pi.enrollment_id = e.id AND pi.installment_number = 1 WHERE e.id = ?`)
    .bind(sanitizeText(enrollmentId, 80)).first();
  if (!enrollment) throw new HttpError(404, 'enrollment_not_found', 'The enrollment is unavailable.');
  const scheduledAt = mode === 'scheduled' ? sanitizeTimestamp(body.scheduledAt) : null;
  if (mode === 'scheduled' && !scheduledAt) throw new HttpError(422, 'activation_policy_invalid', 'Enter a valid scheduled activation time.');
  const onboardingReady = body.onboardingReady === true ? 1 : 0;
  const canActivate = enrollment.initial_payment_status === 'paid' && onboardingReady
    && (mode === 'manual' ? body.activateNow === true : mode === 'automatic' || new Date(scheduledAt).getTime() <= Date.now());
  const now = new Date().toISOString();
  await env.ENROLLMENT_DB.prepare(`UPDATE enrollments SET activation_mode = ?, onboarding_ready = ?, activation_scheduled_at = ?,
    portal_activated_at = CASE WHEN ? = 1 THEN COALESCE(portal_activated_at, ?) ELSE portal_activated_at END,
    activated_at = CASE WHEN ? = 1 THEN COALESCE(activated_at, ?) ELSE activated_at END, updated_at = ? WHERE id = ?`)
    .bind(mode, onboardingReady, scheduledAt, canActivate ? 1 : 0, now, canActivate ? 1 : 0, now, now, enrollment.id).run();
  if (canActivate) {
    await env.ENROLLMENT_DB.batch([
      env.ENROLLMENT_DB.prepare('UPDATE projects SET client_visible = 1, status = CASE WHEN status = \'planned\' THEN \'active\' ELSE status END, updated_at = ? WHERE id = ?').bind(now, enrollment.project_id),
      env.ENROLLMENT_DB.prepare("UPDATE client_users SET access_status = 'active', updated_at = ? WHERE client_id = ?").bind(now, enrollment.client_id),
      auditStatementForAdmin(env.ENROLLMENT_DB, 'portal_activated', session, requestId(request), { clientId: enrollment.client_id, projectId: enrollment.project_id, agreementId: enrollment.agreement_id, enrollmentId: enrollment.id }),
    ]);
  }
  return json({ activationMode: mode, onboardingReady: Boolean(onboardingReady), portalActivated: canActivate, activatedAt: canActivate ? now : null });
}

async function updatePublication({ request, env }) {
  requireTrustedOrigin(request, env); requireJson(request);
  const session = await authenticate(request, env, ['e4la_admin','e4la_collaborator']);
  await requireCsrf(request, session);
  const body = await request.json();
  const tables = {
    milestone: 'project_milestones', update: 'project_updates', deliverable: 'deliverables', document: 'portal_documents',
    phase: 'project_phases', progress_snapshot: 'project_progress_snapshots', performance_metric: 'project_performance_metrics',
  };
  const table = tables[sanitizeText(body.entityType, 20)];
  const status = sanitizeText(body.publicationStatus, 20);
  if (!table || !['internal','reviewed','approved','published','withdrawn'].includes(status)) throw new HttpError(422, 'publication_state_invalid', 'Select a supported publication state.');
  const entity = await env.ENROLLMENT_DB.prepare(`SELECT id, project_id FROM ${table} WHERE id = ?`).bind(sanitizeText(body.entityId, 80)).first();
  if (!entity?.project_id) throw new HttpError(404, 'publication_item_not_found', 'The selected portal item is unavailable.');
  if (session.role === 'e4la_collaborator') {
    const access = await env.ENROLLMENT_DB.prepare('SELECT 1 AS allowed FROM admin_project_access WHERE admin_user_id = ? AND project_id = ? AND permission_level IN (\'contributor\',\'manager\')')
      .bind(session.actor_id, entity.project_id).first();
    if (!access) throw new HttpError(403, 'not_authorized', 'You do not have permission to publish this project.');
  }
  const now = new Date().toISOString();
  await env.ENROLLMENT_DB.prepare(`UPDATE ${table} SET publication_status = ?, published_at = CASE WHEN ? = 'published' THEN COALESCE(published_at, ?) ELSE published_at END, updated_at = ? WHERE id = ?`)
    .bind(status, status, now, now, entity.id).run();
  await audit(env.ENROLLMENT_DB, { type: status === 'published' ? `${body.entityType}_published` : 'portal_publication_changed', actorType: 'admin_user', actorId: session.actor_id, projectId: entity.project_id, relatedType: body.entityType, relatedId: entity.id, requestId: requestId(request), data: { publicationStatus: status } });
  return json({ id: entity.id, publicationStatus: status });
}

async function createProjectItem({ request, env }, projectId) {
  requireTrustedOrigin(request, env); requireJson(request);
  const session = await authenticate(request, env, ['e4la_admin','e4la_collaborator']);
  await requireCsrf(request, session);
  const project = await env.ENROLLMENT_DB.prepare('SELECT id, client_id FROM projects WHERE id = ? AND status != \'archived\'')
    .bind(sanitizeText(projectId, 80)).first();
  if (!project) throw new HttpError(404, 'project_not_found', 'The selected project is unavailable.');
  if (session.role === 'e4la_collaborator') {
    const access = await env.ENROLLMENT_DB.prepare(`SELECT 1 AS allowed FROM admin_project_access
      WHERE admin_user_id = ? AND project_id = ? AND permission_level IN ('contributor','manager')`)
      .bind(session.actor_id, project.id).first();
    if (!access) throw new HttpError(403, 'not_authorized', 'You do not have permission to add client-facing items to this project.');
  }
  const body = await request.json();
  requireFields(body, ['entityType','title','body']);
  const entityType = sanitizeText(body.entityType, 20);
  if (!['update','milestone','deliverable'].includes(entityType)) throw new HttpError(422, 'project_item_invalid', 'Select a supported client-facing item type.');
  const title = sanitizeText(body.title, 180); const description = sanitizeText(body.body, 2000);
  const date = sanitizeDate(body.date); const now = new Date().toISOString(); const entityId = opaqueId(entityType === 'milestone' ? 'mil' : entityType === 'deliverable' ? 'del' : 'upd');
  let statement;
  if (entityType === 'milestone') {
    statement = env.ENROLLMENT_DB.prepare(`INSERT INTO project_milestones
      (id, project_id, title, description, status, target_date, publication_status, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'planned', ?, 'internal', 0, ?, ?)`)
      .bind(entityId, project.id, title, description, date, now, now);
  } else if (entityType === 'deliverable') {
    statement = env.ENROLLMENT_DB.prepare(`INSERT INTO deliverables
      (id, project_id, title, description, deliverable_type, publication_status, completed_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'document', 'internal', ?, ?, ?)`)
      .bind(entityId, project.id, title, description, date ? `${date}T00:00:00.000Z` : null, now, now);
  } else {
    statement = env.ENROLLMENT_DB.prepare(`INSERT INTO project_updates
      (id, project_id, title, body, update_type, publication_status, created_by_admin_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'progress', 'internal', ?, ?, ?)`)
      .bind(entityId, project.id, title, description, session.actor_id, now, now);
  }
  await env.ENROLLMENT_DB.batch([
    statement,
    auditStatementForAdmin(env.ENROLLMENT_DB, 'portal_item_created', session, requestId(request), { clientId: project.client_id, projectId: project.id, entityId, entityType }),
  ]);
  return json({ id: entityId, projectId: project.id, entityType, publicationStatus: 'internal' }, 201);
}

async function assertProjectAccess(env, session, projectId) {
  const project = await env.ENROLLMENT_DB.prepare("SELECT id, client_id FROM projects WHERE id = ? AND status != 'archived'").bind(sanitizeText(projectId, 80)).first();
  if (!project) throw new HttpError(404, 'project_not_found', 'The selected project is unavailable.');
  if (session.role === 'e4la_collaborator') {
    const access = await env.ENROLLMENT_DB.prepare(`SELECT 1 AS allowed FROM admin_project_access
      WHERE admin_user_id = ? AND project_id = ? AND permission_level IN ('contributor','manager')`)
      .bind(session.actor_id, project.id).first();
    if (!access) throw new HttpError(403, 'not_authorized', 'You do not have permission to manage this project.');
  }
  return project;
}

async function createPhase({ request, env }, projectId) {
  requireTrustedOrigin(request, env); requireJson(request);
  const session = await authenticate(request, env, ['e4la_admin','e4la_collaborator']);
  await requireCsrf(request, session);
  const project = await assertProjectAccess(env, session, projectId);
  const body = await request.json();
  requireFields(body, ['name']);
  const status = sanitizeText(body.status, 20) || 'upcoming';
  if (!['completed','current','upcoming','blocked','on_hold'].includes(status)) throw new HttpError(422, 'phase_status_invalid', 'Select a supported phase status.');
  const sequence = Number.parseInt(body.sequence, 10);
  if (!Number.isInteger(sequence) || sequence < 1) throw new HttpError(422, 'phase_sequence_invalid', 'Sequence must be a positive whole number.');
  const now = new Date().toISOString();
  const phaseId = opaqueId('phs');
  try {
    await env.ENROLLMENT_DB.batch([
      env.ENROLLMENT_DB.prepare(`INSERT INTO project_phases
        (id, project_id, name, sequence, status, target_start_date, target_end_date, client_action_required, client_action_note, publication_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'internal', ?, ?)`)
        .bind(phaseId, project.id, sanitizeText(body.name, 180), sequence, status, sanitizeDate(body.target_start_date), sanitizeDate(body.target_end_date),
          body.client_action_required === true ? 1 : 0, sanitizeText(body.client_action_note, 500), now, now),
      auditStatementForAdmin(env.ENROLLMENT_DB, 'phase_created', session, requestId(request), { clientId: project.client_id, projectId: project.id, entityId: phaseId, entityType: 'phase' }),
    ]);
  } catch (error) {
    if (String(error.message || '').includes('UNIQUE')) throw new HttpError(409, 'phase_sequence_taken', 'A phase with this sequence already exists for this project.');
    throw error;
  }
  return json({ id: phaseId, projectId: project.id, publicationStatus: 'internal' }, 201);
}

async function updatePhase({ request, env }, phaseId) {
  requireTrustedOrigin(request, env); requireJson(request);
  const session = await authenticate(request, env, ['e4la_admin','e4la_collaborator']);
  await requireCsrf(request, session);
  const phase = await env.ENROLLMENT_DB.prepare('SELECT id, project_id FROM project_phases WHERE id = ?').bind(sanitizeText(phaseId, 80)).first();
  if (!phase) throw new HttpError(404, 'phase_not_found', 'The selected phase is unavailable.');
  await assertProjectAccess(env, session, phase.project_id);
  const body = await request.json();
  const fields = {};
  if (body.status !== undefined) {
    if (!['completed','current','upcoming','blocked','on_hold'].includes(body.status)) throw new HttpError(422, 'phase_status_invalid', 'Select a supported phase status.');
    fields.status = body.status;
  }
  if (body.target_start_date !== undefined) fields.target_start_date = sanitizeDate(body.target_start_date);
  if (body.target_end_date !== undefined) fields.target_end_date = sanitizeDate(body.target_end_date);
  if (body.client_action_required !== undefined) fields.client_action_required = body.client_action_required === true ? 1 : 0;
  if (body.client_action_note !== undefined) fields.client_action_note = sanitizeText(body.client_action_note, 500);
  const keys = Object.keys(fields);
  if (!keys.length) throw new HttpError(422, 'phase_update_empty', 'Provide at least one supported field to update.');
  const now = new Date().toISOString();
  await env.ENROLLMENT_DB.prepare(`UPDATE project_phases SET ${keys.map((key) => `${key} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .bind(...keys.map((key) => fields[key]), now, phase.id).run();
  return json({ id: phase.id, updated: keys });
}

async function createProgressSnapshot({ request, env }, projectId) {
  requireTrustedOrigin(request, env); requireJson(request);
  const session = await authenticate(request, env, ['e4la_admin','e4la_collaborator']);
  await requireCsrf(request, session);
  const project = await assertProjectAccess(env, session, projectId);
  const body = await request.json();
  requireFields(body, ['snapshot_date']);
  const weekNumber = Number.parseInt(body.week_number, 10);
  const completed = Number.parseInt(body.completed_milestones_count, 10);
  const total = Number.parseInt(body.total_milestones_count, 10);
  if (!Number.isInteger(weekNumber) || weekNumber < 1) throw new HttpError(422, 'snapshot_week_invalid', 'Week number must be a positive whole number.');
  if (!Number.isInteger(completed) || !Number.isInteger(total) || completed < 0 || total < 0 || completed > total) {
    throw new HttpError(422, 'snapshot_counts_invalid', 'Completed and total milestone counts must be whole numbers, and completed cannot exceed total.');
  }
  const snapshotDate = sanitizeDate(body.snapshot_date);
  if (!snapshotDate) throw new HttpError(422, 'snapshot_date_invalid', 'Enter a valid snapshot date.');
  const now = new Date().toISOString();
  const snapshotId = opaqueId('pgs');
  try {
    await env.ENROLLMENT_DB.batch([
      env.ENROLLMENT_DB.prepare(`INSERT INTO project_progress_snapshots
        (id, project_id, snapshot_date, week_number, completed_milestones_count, total_milestones_count, publication_status, created_by_admin_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'internal', ?, ?, ?)`)
        .bind(snapshotId, project.id, snapshotDate, weekNumber, completed, total, session.actor_id, now, now),
      auditStatementForAdmin(env.ENROLLMENT_DB, 'progress_snapshot_created', session, requestId(request), { clientId: project.client_id, projectId: project.id, entityId: snapshotId, entityType: 'progress_snapshot' }),
    ]);
  } catch (error) {
    if (String(error.message || '').includes('UNIQUE')) throw new HttpError(409, 'snapshot_week_taken', 'A progress snapshot already exists for this project and week.');
    throw error;
  }
  return json({ id: snapshotId, projectId: project.id, publicationStatus: 'internal' }, 201);
}

async function createPerformanceMetric({ request, env }, projectId) {
  requireTrustedOrigin(request, env); requireJson(request);
  const session = await authenticate(request, env, ['e4la_admin','e4la_collaborator']);
  await requireCsrf(request, session);
  const project = await assertProjectAccess(env, session, projectId);
  const body = await request.json();
  requireFields(body, ['metric_key','label','current_value']);
  const category = sanitizeText(body.category, 20) || 'general';
  if (!['visibility','website_ux','content','business_growth','general'].includes(category)) throw new HttpError(422, 'metric_category_invalid', 'Select a supported metric category.');
  const trend = sanitizeText(body.trend, 10) || 'flat';
  if (!['up','down','flat'].includes(trend)) throw new HttpError(422, 'metric_trend_invalid', 'Select a supported trend direction.');
  const now = new Date().toISOString();
  const metricId = opaqueId('met');
  try {
    await env.ENROLLMENT_DB.batch([
      env.ENROLLMENT_DB.prepare(`INSERT INTO project_performance_metrics
        (id, project_id, metric_key, label, category, current_value, baseline_value, trend, interpretation, sort_order, publication_status, created_by_admin_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'internal', ?, ?, ?)`)
        .bind(metricId, project.id, sanitizeText(body.metric_key, 60), sanitizeText(body.label, 120), category,
          sanitizeText(body.current_value, 60), sanitizeText(body.baseline_value, 120), trend, sanitizeText(body.interpretation, 500),
          Number.isInteger(body.sort_order) ? body.sort_order : 0, session.actor_id, now, now),
      auditStatementForAdmin(env.ENROLLMENT_DB, 'performance_metric_created', session, requestId(request), { clientId: project.client_id, projectId: project.id, entityId: metricId, entityType: 'performance_metric' }),
    ]);
  } catch (error) {
    if (String(error.message || '').includes('UNIQUE')) throw new HttpError(409, 'metric_key_taken', 'A metric with this key already exists for this project.');
    throw error;
  }
  return json({ id: metricId, projectId: project.id, publicationStatus: 'internal' }, 201);
}

async function updatePerformanceMetric({ request, env }, metricId) {
  requireTrustedOrigin(request, env); requireJson(request);
  const session = await authenticate(request, env, ['e4la_admin','e4la_collaborator']);
  await requireCsrf(request, session);
  const metric = await env.ENROLLMENT_DB.prepare('SELECT id, project_id FROM project_performance_metrics WHERE id = ?').bind(sanitizeText(metricId, 80)).first();
  if (!metric) throw new HttpError(404, 'metric_not_found', 'The selected metric is unavailable.');
  await assertProjectAccess(env, session, metric.project_id);
  const body = await request.json();
  const fields = {};
  if (body.current_value !== undefined) fields.current_value = sanitizeText(body.current_value, 60);
  if (body.baseline_value !== undefined) fields.baseline_value = sanitizeText(body.baseline_value, 120);
  if (body.trend !== undefined) {
    if (!['up','down','flat'].includes(body.trend)) throw new HttpError(422, 'metric_trend_invalid', 'Select a supported trend direction.');
    fields.trend = body.trend;
  }
  if (body.interpretation !== undefined) fields.interpretation = sanitizeText(body.interpretation, 500);
  const keys = Object.keys(fields);
  if (!keys.length) throw new HttpError(422, 'metric_update_empty', 'Provide at least one supported field to update.');
  const now = new Date().toISOString();
  await env.ENROLLMENT_DB.prepare(`UPDATE project_performance_metrics SET ${keys.map((key) => `${key} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .bind(...keys.map((key) => fields[key]), now, metric.id).run();
  return json({ id: metric.id, updated: keys });
}

async function adminPreview({ request, env }, clientId) {
  const session = await authenticate(request, env, ['e4la_admin','e4la_collaborator']);
  const client = await env.ENROLLMENT_DB.prepare('SELECT id FROM clients WHERE id = ?').bind(sanitizeText(clientId, 80)).first();
  if (!client) throw new HttpError(404, 'client_not_found', 'The client preview is unavailable.');
  if (session.role === 'e4la_collaborator') {
    const access = await env.ENROLLMENT_DB.prepare(`SELECT 1 AS allowed FROM projects p JOIN admin_project_access apa ON apa.project_id = p.id WHERE p.client_id = ? AND apa.admin_user_id = ? LIMIT 1`)
      .bind(client.id, session.actor_id).first();
    if (!access) throw new HttpError(403, 'not_authorized', 'You do not have permission to preview this client portal.');
  }
  await audit(env.ENROLLMENT_DB, { type: 'admin_portal_previewed', actorType: 'admin_user', actorId: session.actor_id, clientId: client.id, requestId: requestId(request) });
  return json({ adminPreview: true, label: 'ADMIN PREVIEW', portal: await loadPortalData(env.ENROLLMENT_DB, client.id) });
}

function opaqueId(prefix) { return `${prefix}_${randomToken(18)}`; }
function sanitizeDate(value) { const text = sanitizeText(value, 10); return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null; }
function sanitizeTimestamp(value) { const text = sanitizeText(value, 40); const date = new Date(text); return text && Number.isFinite(date.getTime()) ? date.toISOString() : null; }
function distribute(total, count) { const base = Math.floor(total / count); const values = Array(count).fill(base); values[0] += total - base * count; return values; }
function buildApprovedPlan(code, total, versionId, now) {
  const definitions = {
    pay_full: { name: 'Pay in Full', count: 1, unit: 'one_time', interval: 0, step: 0, offsetUnit: 'month' },
    three_monthly: { name: 'Three Monthly Installments', count: 3, unit: 'month', interval: 1, step: 1, offsetUnit: 'month' },
    six_biweekly: { name: 'Six Biweekly Installments', count: 6, unit: 'week', interval: 2, step: 2, offsetUnit: 'week' },
  };
  const definition = definitions[code];
  return { id: opaqueId('plan'), code, ...definition, schedule: distribute(total, definition.count).map((amount, index) => ({ amount, offsetUnit: definition.offsetUnit, offset: index * definition.step })), versionId, now };
}
function phaseCLegalPlaceholder(programName, startDate, total) {
  return `PHASE C LEGAL DOCUMENT PLACEHOLDER — NOT APPROVED FOR CLIENT USE\n\nProgram: ${sanitizeText(programName, 180)}\nStart date: ${sanitizeDate(startDate) || 'To be confirmed'}\nTotal program fee (cents): ${total}\n\nAttorney-approved service agreement, installment authorization, electronic acceptance, privacy, cancellation, refund, and failed-payment language must replace this placeholder before production.`;
}
function standardAcknowledgements() {
  return [
    ['fixed_term','I understand that this is a fixed 90-day engagement and not a month-to-month subscription.'],
    ['fee_commitment','I understand that the Total Program Fee is committed and installments are a payment schedule only.'],
    ['automatic_charges','I authorize E4LA to automatically charge the payment method provided according to the selected Payment Schedule.'],
    ['no_guarantees','I understand that specific rankings, revenue, leads, sales, advertising results, or other business outcomes are not guaranteed.'],
    ['client_responsibilities','I understand my responsibilities regarding approvals, access, content, information, and coordination with other marketing activities.'],
    ['full_agreement','I have reviewed, understood, and agree to the E4LA Client Services Agreement.'],
  ].map(([id, text]) => ({ id, text, required: true }));
}
function auditStatementForAdmin(db, eventType, session, requestIdentifier, data) {
  return db.prepare(`INSERT INTO audit_events (
    id, event_type, actor_type, actor_id, client_id, project_id, agreement_id, enrollment_id,
    related_entity_type, related_entity_id, request_id, event_data_json, created_at
  ) VALUES (?, ?, 'admin_user', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), eventType, session.actor_id, data.clientId || null, data.projectId || null,
      data.agreementId || null, data.enrollmentId || null, data.versionId ? 'agreement_version' : data.inviteId ? 'agreement_invite' : data.entityType || null,
      data.versionId || data.inviteId || data.entityId || null, requestIdentifier, JSON.stringify(data), new Date().toISOString());
}

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function buildSchedule(definitions, start) {
  return definitions.map((definition, index) => {
    const due = new Date(start);
    const offset = Number(definition.offset || 0);
    if (definition.offsetUnit === 'week') due.setUTCDate(due.getUTCDate() + offset * 7);
    if (definition.offsetUnit === 'month') {
      const day = due.getUTCDate();
      due.setUTCDate(1);
      due.setUTCMonth(due.getUTCMonth() + offset);
      const lastDay = new Date(Date.UTC(due.getUTCFullYear(), due.getUTCMonth() + 1, 0)).getUTCDate();
      due.setUTCDate(Math.min(day, lastDay));
    }
    return { number: index + 1, amount: Number(definition.amount), dueAt: due.toISOString() };
  });
}

async function saveStripeObject(db, enrollmentId, type, object) {
  await stripeObjectStatement(db, enrollmentId, type, object).run();
}

function stripeObjectStatement(db, enrollmentId, type, object) {
  const now = new Date().toISOString();
  return db.prepare(`INSERT INTO stripe_objects (
    id, enrollment_id, stripe_object_type, stripe_object_id, livemode, status, metadata_json, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(stripe_object_type, stripe_object_id) DO UPDATE SET status = excluded.status, metadata_json = excluded.metadata_json, updated_at = excluded.updated_at`)
    .bind(crypto.randomUUID(), enrollmentId, type, object.id, object.livemode ? 1 : 0, object.status || null, JSON.stringify(object.metadata || {}), now, now);
}

function auditStatement(db, type, record, requestIdentifier, data) {
  return db.prepare(`INSERT INTO audit_events (
    id, event_type, actor_type, client_id, project_id, agreement_id, enrollment_id, request_id, event_data_json, created_at
  ) VALUES (?, ?, 'agreement_signer', ?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), type, record.client_id, record.project_id, record.agreement_id, record.id, requestIdentifier, JSON.stringify(data), new Date().toISOString());
}
