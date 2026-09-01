import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { onRequestPost as handleStripeWebhook } from '../functions/api/stripe/webhook.js';
import { onRequest as handleOperationsRequest } from '../functions/api/ops/[[path]].js';
import { createSession } from '../functions/_shared/ops-security.js';

// Phase D (Stripe/billing angle). These tests intentionally avoid any real network
// call: Stripe is always reached through a mocked `fetch`, and every scenario runs
// against an in-memory D1 built from the same migrations/fixtures phase-c.test.mjs
// uses. Coverage already proven in tests/phase-c.test.mjs (fixed schedules starting
// at installment two, exact iteration counts, replayed invoice evidence not
// advancing a second installment, schedule completion failing closed, webhook
// HMAC/timestamp verification, live-key rejection) is not repeated here.

const migration1 = await readFile(new URL('../migrations/0001_client_operations.sql', import.meta.url), 'utf8');
const migration2 = await readFile(new URL('../migrations/0002_phase_c_preview.sql', import.meta.url), 'utf8');
const migration3 = await readFile(new URL('../migrations/0003_payment_plans_immutable.sql', import.meta.url), 'utf8');
const previewFixture = await readFile(new URL('../fixtures/client-operations.preview.sql', import.meta.url), 'utf8');

test('a webhook-less "success" redirect never confirms payment; only the signed Stripe webhook does', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  // Simulate that /api/ops/checkout already ran for enr_preview_b (Pay in Full, single installment).
  database.exec(`
    UPDATE enrollments SET status='checkout_pending', updated_at='2026-08-20T00:00:00.000Z' WHERE id='enr_preview_b';
    UPDATE payment_installments SET status='checkout_pending', updated_at='2026-08-20T00:00:00.000Z' WHERE id='pay_preview_b';
  `);
  const signerSession = await createSession(env.ENROLLMENT_DB, {
    actorType: 'agreement_signer', clientId: 'clt_preview_b', agreementId: 'agr_preview_b', role: 'agreement_signer', ttlSeconds: 1800,
  });

  // The browser returning to #checkout-returned only ever triggers a GET read.
  const source = await readFile(new URL('../assets/js/client-agreement.js', import.meta.url), 'utf8');
  assert.match(source, /is not payment proof/i);
  assert.doesNotMatch(source, /fetch\(.*enrollment\/status.*method:\s*['"]POST/is);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await operationsRequest(env, 'GET', '/api/ops/enrollment/status', signerSession);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.enrollment.status, 'checkout_pending');
  }
  assert.equal(database.prepare("SELECT status FROM payment_installments WHERE id='pay_preview_b'").get().status, 'checkout_pending');

  // Only the signed webhook can flip it to paid.
  const originalFetch = globalThis.fetch;
  try {
    const response = await signedWebhook(env, {
      id: 'evt_success_redirect_is_not_proof', type: 'checkout.session.completed', livemode: false,
      data: { object: {
        id: 'cs_preview_b', payment_status: 'paid', payment_intent: 'pi_preview_b', livemode: false,
        client_reference_id: 'enr_preview_b', metadata: { e4la_enrollment_id: 'enr_preview_b' },
      } },
    });
    assert.equal(response.status, 200);
  } finally { globalThis.fetch = originalFetch; }
  assert.equal(database.prepare("SELECT status FROM enrollments WHERE id='enr_preview_b'").get().status, 'paid');
  assert.equal(database.prepare("SELECT status FROM payment_installments WHERE id='pay_preview_b'").get().status, 'paid');
  database.close();
});

test('a delayed webhook still reconciles a multi-installment enrollment correctly once it arrives', async () => {
  const database = previewDatabase();
  seedMonthlyEnrollment(database, {
    enrollmentId: 'enr_test_delayed', createdAt: '2026-07-01T00:00:00.000Z',
    secondDueAt: '2030-10-15T00:00:00.000Z', thirdDueAt: '2030-11-15T00:00:00.000Z',
  });
  const env = operationsEnvironment(database);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes('/payment_intents/')) {
      return new Response(JSON.stringify({ id: 'pi_test_delayed', customer: 'cus_test_delayed', payment_method: 'pm_test_delayed', livemode: false }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: 'sched_test_delayed', status: 'not_started', livemode: false, subscription: 'sub_test_delayed' }), { status: 200 });
  };
  try {
    const response = await signedWebhook(env, {
      id: 'evt_delayed_checkout', type: 'checkout.session.completed', livemode: false,
      data: { object: {
        id: 'cs_test_delayed', payment_status: 'paid', payment_intent: 'pi_test_delayed', livemode: false,
        client_reference_id: 'enr_test_delayed', metadata: { e4la_enrollment_id: 'enr_test_delayed' },
      } },
    });
    assert.equal(response.status, 200);
  } finally { globalThis.fetch = originalFetch; }
  const enrollment = database.prepare("SELECT status, next_payment_due_at FROM enrollments WHERE id='enr_test_delayed'").get();
  assert.equal(enrollment.status, 'schedule_active');
  assert.equal(enrollment.next_payment_due_at, '2030-10-15T00:00:00.000Z');
  assert.equal(database.prepare("SELECT status FROM payment_installments WHERE enrollment_id='enr_test_delayed' AND installment_number=1").get().status, 'paid');
  assert.equal(database.prepare("SELECT status FROM agreements WHERE id='agr_enr_test_delayed'").get().status, 'enrolled');
  assert.ok(database.prepare("SELECT 1 FROM stripe_objects WHERE enrollment_id='enr_test_delayed' AND stripe_object_type='subscription_schedule'").get());
  database.close();
});

test('duplicate Stripe webhook delivery (same event id) is idempotent: no double schedule, no double audit, no ledger drift', async () => {
  const database = previewDatabase();
  seedMonthlyEnrollment(database, { enrollmentId: 'enr_test_dup', secondDueAt: '2030-10-20T00:00:00.000Z', thirdDueAt: '2030-11-20T00:00:00.000Z' });
  const env = operationsEnvironment(database);
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls += 1;
    if (String(url).includes('/payment_intents/')) {
      return new Response(JSON.stringify({ id: 'pi_test_dup', customer: 'cus_test_dup', payment_method: 'pm_test_dup', livemode: false }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: 'sched_test_dup', status: 'not_started', livemode: false, subscription: 'sub_test_dup' }), { status: 200 });
  };
  const event = {
    id: 'evt_duplicate_delivery', type: 'checkout.session.completed', livemode: false,
    data: { object: {
      id: 'cs_test_dup', payment_status: 'paid', payment_intent: 'pi_test_dup', livemode: false,
      client_reference_id: 'enr_test_dup', metadata: { e4la_enrollment_id: 'enr_test_dup' },
    } },
  };
  try {
    const first = await signedWebhook(env, event);
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { received: true });
    const callsAfterFirst = calls;
    assert.ok(callsAfterFirst > 0);

    const second = await signedWebhook(env, event);
    assert.equal(second.status, 200);
    assert.deepEqual(await second.json(), { received: true, duplicate: true });
    assert.equal(calls, callsAfterFirst, 'duplicate delivery must not call Stripe again');
  } finally { globalThis.fetch = originalFetch; }

  assert.equal(database.prepare("SELECT status FROM enrollments WHERE id='enr_test_dup'").get().status, 'schedule_active');
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM payment_installments WHERE enrollment_id='enr_test_dup' AND status='paid'").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM stripe_objects WHERE enrollment_id='enr_test_dup' AND stripe_object_type='subscription_schedule'").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE enrollment_id='enr_test_dup' AND event_type='payment_confirmed'").get().count, 1);
  assert.equal(database.prepare("SELECT attempts, status FROM processed_webhook_events WHERE event_id='evt_duplicate_delivery'").get().status, 'processed');
  database.close();
});

test('out-of-order invoice.paid events reconcile safely: every installment paid exactly once, no invoice reused, none skipped', async () => {
  const database = previewDatabase();
  seedScheduleActive(database, { enrollmentId: 'enr_test_ooo', subscriptionId: 'sub_test_ooo', scheduleId: 'sched_test_ooo', amount: 120000 });
  const env = operationsEnvironment(database);

  // Network reordering: the invoice that Stripe actually generated for installment #3
  // is delivered to us before the one for installment #2.
  let response = await signedWebhook(env, {
    id: 'evt_ooo_first_delivered', type: 'invoice.paid', livemode: false,
    data: { object: { id: 'in_ooo_arrived_first', subscription: 'sub_test_ooo', status: 'paid', livemode: false } },
  });
  assert.equal(response.status, 200);
  // installment 1 was already paid via Checkout before the schedule started; the assertions
  // below focus on installments 2 and 3, which are the ones the schedule's invoices settle.
  let paidRows = database.prepare("SELECT installment_number, stripe_invoice_id FROM payment_installments WHERE enrollment_id='enr_test_ooo' AND status='paid' AND installment_number > 1 ORDER BY installment_number").all();
  assert.deepEqual(paidRows.map((r) => r.installment_number), [2]);
  assert.equal(paidRows[0].stripe_invoice_id, 'in_ooo_arrived_first');

  response = await signedWebhook(env, {
    id: 'evt_ooo_second_delivered', type: 'invoice.paid', livemode: false,
    data: { object: { id: 'in_ooo_arrived_second', subscription: 'sub_test_ooo', status: 'paid', livemode: false } },
  });
  assert.equal(response.status, 200);
  paidRows = database.prepare("SELECT installment_number, stripe_invoice_id FROM payment_installments WHERE enrollment_id='enr_test_ooo' AND status='paid' AND installment_number > 1 ORDER BY installment_number").all();
  assert.deepEqual(paidRows.map((r) => r.installment_number), [2, 3]);
  const invoiceIds = paidRows.map((r) => r.stripe_invoice_id);
  assert.equal(new Set(invoiceIds).size, 2, 'each invoice id must be attributed to exactly one installment');

  // A stray extra delivery beyond the fixed schedule must not corrupt the ledger.
  response = await signedWebhook(env, {
    id: 'evt_ooo_extra_delivery', type: 'invoice.paid', livemode: false,
    data: { object: { id: 'in_ooo_extra', subscription: 'sub_test_ooo', status: 'paid', livemode: false } },
  });
  assert.equal(response.status, 200);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM payment_installments WHERE enrollment_id='enr_test_ooo' AND status='paid'").get().count, 3);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM payment_installments WHERE enrollment_id='enr_test_ooo' AND status != 'paid'").get().count, 0);
  database.close();
});

test('card decline and authentication-required failures map to explicit, distinct, recoverable D1 states — never silently paid', async () => {
  const database = previewDatabase();
  seedScheduleActive(database, { enrollmentId: 'enr_test_declined', subscriptionId: 'sub_test_declined', scheduleId: 'sched_test_declined', amount: 120000 });
  const env = operationsEnvironment(database);

  let response = await signedWebhook(env, {
    id: 'evt_card_declined', type: 'invoice.payment_failed', livemode: false,
    data: { object: { id: 'in_declined', subscription: 'sub_test_declined', status: 'open', livemode: false } },
  });
  assert.equal(response.status, 200);
  assert.equal(database.prepare("SELECT status FROM enrollments WHERE id='enr_test_declined'").get().status, 'payment_failed');
  const declinedInstallment = database.prepare("SELECT status, stripe_invoice_id FROM payment_installments WHERE enrollment_id='enr_test_declined' AND installment_number=2").get();
  assert.equal(declinedInstallment.status, 'failed');
  assert.equal(declinedInstallment.stripe_invoice_id, 'in_declined');

  const database2 = previewDatabase();
  seedScheduleActive(database2, { enrollmentId: 'enr_test_3ds', subscriptionId: 'sub_test_3ds', scheduleId: 'sched_test_3ds', amount: 60000 });
  const env2 = operationsEnvironment(database2);
  response = await signedWebhook(env2, {
    id: 'evt_authentication_required', type: 'invoice.payment_action_required', livemode: false,
    data: { object: { id: 'in_3ds', subscription: 'sub_test_3ds', status: 'open', livemode: false } },
  });
  assert.equal(response.status, 200);
  assert.equal(database2.prepare("SELECT status FROM enrollments WHERE id='enr_test_3ds'").get().status, 'payment_action_required');
  assert.equal(database2.prepare("SELECT status FROM payment_installments WHERE enrollment_id='enr_test_3ds' AND installment_number=2").get().status, 'action_required');
  database.close();
  database2.close();
});

test('a Subscription Schedule failure after a successful Checkout leaves an explicit recoverable state, and a later retry heals it', async () => {
  const database = previewDatabase();
  seedMonthlyEnrollment(database, { enrollmentId: 'enr_test_schedfail', secondDueAt: '2030-12-01T00:00:00.000Z', thirdDueAt: '2031-01-01T00:00:00.000Z' });
  const env = operationsEnvironment(database);
  const event = {
    id: 'evt_schedule_creation_failed', type: 'checkout.session.completed', livemode: false,
    data: { object: {
      id: 'cs_test_schedfail', payment_status: 'paid', payment_intent: 'pi_test_schedfail', livemode: false,
      client_reference_id: 'enr_test_schedfail', metadata: { e4la_enrollment_id: 'enr_test_schedfail' },
    } },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/payment_intents/')) {
      return new Response(JSON.stringify({ id: 'pi_test_schedfail', customer: 'cus_test_schedfail', payment_method: 'pm_test_schedfail', livemode: false }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: { message: 'Your card was declined while attaching the default payment method.' } }), { status: 402 });
  };
  let response;
  try {
    response = await signedWebhook(env, event);
  } finally { globalThis.fetch = originalFetch; }
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error.code, 'stripe_request_failed');
  assert.equal(database.prepare("SELECT status FROM enrollments WHERE id='enr_test_schedfail'").get().status, 'attention_required');
  assert.equal(database.prepare("SELECT status, stripe_payment_intent_id FROM payment_installments WHERE enrollment_id='enr_test_schedfail' AND installment_number=1").get().status, 'paid');
  assert.equal(database.prepare("SELECT status FROM processed_webhook_events WHERE event_id='evt_schedule_creation_failed'").get().status, 'failed');

  // Stripe retries the same event id; this time schedule creation succeeds.
  globalThis.fetch = async (url) => {
    if (String(url).includes('/payment_intents/')) {
      return new Response(JSON.stringify({ id: 'pi_test_schedfail', customer: 'cus_test_schedfail', payment_method: 'pm_test_schedfail', livemode: false }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: 'sched_test_schedfail_retry', status: 'not_started', livemode: false, subscription: 'sub_test_schedfail_retry' }), { status: 200 });
  };
  try {
    response = await signedWebhook(env, event);
  } finally { globalThis.fetch = originalFetch; }
  assert.equal(response.status, 200);
  assert.equal(database.prepare("SELECT status FROM enrollments WHERE id='enr_test_schedfail'").get().status, 'schedule_active');
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM payment_installments WHERE enrollment_id='enr_test_schedfail' AND status='paid'").get().count, 1, 'the already-charged installment 1 must not be duplicated or re-charged by the retry');
  assert.equal(database.prepare("SELECT status FROM processed_webhook_events WHERE event_id='evt_schedule_creation_failed'").get().status, 'processed');
  database.close();
});

test('server-side canonical plan/price values cannot be overridden by the client during agreement acceptance', async () => {
  const database = previewDatabase();
  database.exec(`
    INSERT INTO payment_plans (id, agreement_version_id, plan_code, display_name, total_contract_value, currency, installment_count, interval_unit, interval_count, installment_schedule_json, active, created_at)
    VALUES ('plan_test_a_monthly','agrv_preview_a','three_monthly','Three Monthly Installments',360000,'usd',3,'month',1,
      '[{"amount":120000,"offsetUnit":"month","offset":0},{"amount":120000,"offsetUnit":"month","offset":1},{"amount":120000,"offsetUnit":"month","offset":2}]',1,'2026-08-20T00:00:00.000Z');
  `);
  const env = operationsEnvironment(database);
  const session = await createSession(env.ENROLLMENT_DB, {
    actorType: 'agreement_signer', clientId: 'clt_preview_a', agreementId: 'agr_preview_a', role: 'agreement_signer', ttlSeconds: 1800,
  });
  const validClient = {
    legalBusinessName: 'Fictional Alder Studio LLC', contactName: 'Ada Lovelace', email: 'owner+a@example.test',
    phone: '555-0100', title: 'Owner', billingAddress: '1 Example Way', city: 'Los Angeles', state: 'CA', zip: '90001',
  };

  // 7a: a plan id borrowed from a different agreement (a different client's pricing) must be rejected server-side.
  let response = await operationsRequest(env, 'POST', '/api/ops/agreements/accept', session, {
    paymentPlanId: 'plan_preview_b', signerName: 'Ada Lovelace', signerRole: 'Owner', signerCompany: 'Fictional Alder Studio LLC',
    typedAcceptance: 'Ada Lovelace', authorityConfirmed: true, acknowledgedClauseIds: ['fixed_term', 'fee_commitment'],
    client: validClient,
  }, session.csrfToken);
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, 'payment_plan_invalid');
  assert.equal(database.prepare("SELECT status FROM agreements WHERE id='agr_preview_a'").get().status, 'sent', 'a rejected tampered plan must not mutate agreement state');

  // 7b: a valid plan id with spoofed price/amount fields in the body must be ignored; canonical DB values win.
  response = await operationsRequest(env, 'POST', '/api/ops/agreements/accept', session, {
    paymentPlanId: 'plan_test_a_monthly', signerName: 'Ada Lovelace', signerRole: 'Owner', signerCompany: 'Fictional Alder Studio LLC',
    typedAcceptance: 'Ada Lovelace', authorityConfirmed: true, acknowledgedClauseIds: ['fixed_term', 'fee_commitment'],
    client: validClient,
    totalContractValue: 1, installmentAmounts: [1, 1, 1], amount: 1, price: 'price_attacker_supplied',
  }, session.csrfToken);
  assert.equal(response.status, 200);
  const accepted = await response.json();
  const acceptance = database.prepare('SELECT total_contract_value, installment_amounts_json FROM agreement_acceptances WHERE agreement_id=?').get(accepted.agreementId);
  assert.equal(acceptance.total_contract_value, 360000);
  assert.deepEqual(JSON.parse(acceptance.installment_amounts_json), [120000, 120000, 120000]);
  database.close();
});

test('unrelated Stripe events (e.g. a payment-method replacement via the Billing Portal) are ignored and never disrupt the installment ledger', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const before = {
    installments: database.prepare('SELECT id, status, stripe_invoice_id, paid_at FROM payment_installments ORDER BY id').all(),
    enrollments: database.prepare('SELECT id, status, next_payment_due_at FROM enrollments ORDER BY id').all(),
  };
  for (const eventType of ['payment_method.attached', 'customer.updated', 'setup_intent.succeeded']) {
    const response = await signedWebhook(env, {
      id: `evt_${eventType.replace(/\./g, '_')}`, type: eventType, livemode: false,
      data: { object: { id: `obj_${eventType}`, customer: 'cus_preview_c', livemode: false } },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { received: true });
  }
  const after = {
    installments: database.prepare('SELECT id, status, stripe_invoice_id, paid_at FROM payment_installments ORDER BY id').all(),
    enrollments: database.prepare('SELECT id, status, next_payment_due_at FROM enrollments ORDER BY id').all(),
  };
  assert.deepEqual(after, before);
  database.close();
});

test('Billing Portal session creation checks the caller role before ever contacting Stripe', async () => {
  const database = previewDatabase();
  database.exec(`
    INSERT INTO stripe_objects (id, enrollment_id, stripe_object_type, stripe_object_id, livemode, status, created_at, updated_at)
    VALUES ('so_test_customer_d','enr_preview_d','customer','cus_test_billing_portal_d',0,'active','2026-08-20T00:00:00.000Z','2026-08-20T00:00:00.000Z');
  `);
  const env = operationsEnvironment(database);
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { calls += 1; return new Response(JSON.stringify({ id: 'bps_test', url: 'https://billing.stripe.test/session/test', livemode: false }), { status: 200 }); };
  try {
    const viewer = await createSession(env.ENROLLMENT_DB, {
      actorType: 'client_user', actorId: 'usr_preview_d', clientId: 'clt_preview_d', role: 'client_viewer', ttlSeconds: 3600,
    });
    let response = await operationsRequest(env, 'POST', '/api/ops/billing/portal', viewer, {}, viewer.csrfToken);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, 'not_authorized');
    assert.equal(calls, 0, 'an unauthorized role must never trigger a Stripe network call');

    const owner = await createSession(env.ENROLLMENT_DB, {
      actorType: 'client_user', actorId: 'usr_preview_d', clientId: 'clt_preview_d', role: 'client_owner', ttlSeconds: 3600,
    });
    response = await operationsRequest(env, 'POST', '/api/ops/billing/portal', owner, {}, owner.csrfToken);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).portalUrl, 'https://billing.stripe.test/session/test');
    assert.equal(calls, 1);
    assert.ok(database.prepare("SELECT 1 FROM stripe_objects WHERE enrollment_id='enr_preview_d' AND stripe_object_type='portal_session'").get());
  } finally { globalThis.fetch = originalFetch; }
  database.close();
});

function previewDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec(migration1); database.exec(migration2); database.exec(migration3); database.exec(previewFixture);
  return database;
}

function d1Adapter(database) {
  const wrap = (sql) => {
    let values = [];
    return {
      bind(...next) { values = next; return this; },
      async first() { return database.prepare(sql).get(...values) || null; },
      async all() { return { results: database.prepare(sql).all(...values) }; },
      async run() { return database.prepare(sql).run(...values); },
      async batchResult() { return { results: database.prepare(sql).all(...values) }; },
    };
  };
  return { prepare: wrap, async batch(statements) { database.exec('BEGIN'); try { const results = []; for (const statement of statements) results.push(await statement.batchResult()); database.exec('COMMIT'); return results; } catch (error) { database.exec('ROLLBACK'); throw error; } } };
}

function operationsEnvironment(database) {
  return {
    ENVIRONMENT: 'preview', PUBLIC_SITE_URL: 'https://e4la-client-operations-preview.pages.dev',
    ENROLLMENT_SESSION_SECRET: 'preview-test-only', ENROLLMENT_DB: d1Adapter(database),
    STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture',
    STRIPE_API_VERSION: '2026-08-01.test', STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_fixture',
  };
}

function operationsRequest(env, method, path, session, body, csrfToken) {
  const headers = { Cookie: `__Host-e4la_ops=${encodeURIComponent(session.token)}` };
  if (body !== undefined) {
    headers.Origin = 'https://e4la-client-operations-preview.pages.dev';
    headers['Content-Type'] = 'application/json';
  }
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
  const request = new Request(`https://e4la-client-operations-preview.pages.dev${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return handleOperationsRequest({ request, env });
}

async function signedWebhook(env, event) {
  const body = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`));
  const digest = Buffer.from(signature).toString('hex');
  const request = new Request('https://e4la-client-operations-preview.pages.dev/api/stripe/webhook', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${timestamp},v1=${digest}` }, body,
  });
  return handleStripeWebhook({ request, env });
}

// Seeds a fresh "Three Monthly Installments" enrollment (installment 1 = $1,200 via Checkout,
// installments 2-3 still planned) hanging off the existing agr_preview_a / clt_preview_a fixture
// scaffolding, in status 'checkout_pending' as if /api/ops/checkout already ran.
function seedMonthlyEnrollment(database, { enrollmentId, createdAt = '2026-08-20T00:00:00.000Z', secondDueAt, thirdDueAt }) {
  const planId = `plan_${enrollmentId}`;
  const acceptanceId = `acc_${enrollmentId}`;
  const agreementId = `agr_${enrollmentId}`;
  database.exec(`
    INSERT INTO agreements (id, client_id, project_id, status, program_name, current_version_id, accepted_version_id, expires_at, sent_at, viewed_at, accepted_at, created_at, updated_at)
    VALUES ('${agreementId}','clt_preview_a','prj_preview_a','sent','90-Day Growth Program','agrv_preview_a',NULL,'2026-09-15T00:00:00.000Z','${createdAt}',NULL,NULL,'${createdAt}','${createdAt}');

    INSERT INTO payment_plans (id, agreement_version_id, plan_code, display_name, total_contract_value, currency, installment_count, interval_unit, interval_count, installment_schedule_json, stripe_initial_price_id, stripe_remaining_price_id, active, created_at)
    VALUES ('${planId}','agrv_preview_a','three_monthly_${enrollmentId}','Three Monthly Installments',360000,'usd',3,'month',1,
      '[{"amount":120000,"offsetUnit":"month","offset":0},{"amount":120000,"offsetUnit":"month","offset":1},{"amount":120000,"offsetUnit":"month","offset":2}]',
      'price_${enrollmentId}_initial','price_${enrollmentId}_remaining',1,'${createdAt}');

    INSERT INTO agreement_acceptances (id, agreement_id, agreement_version_id, client_id, project_id, payment_plan_id, legal_document_hash, rendered_agreement_snapshot, total_contract_value, installment_amounts_json, installment_dates_json, acknowledged_clause_ids_json, authorized_signer_name, authorized_signer_role, signer_company, typed_acceptance, authority_confirmed, accepted_at_utc, request_id, user_agent, created_at)
    VALUES ('${acceptanceId}','${agreementId}','agrv_preview_a','clt_preview_a','prj_preview_a','${planId}','phase-c-fixture-hash-a','PHASE C LEGAL PLACEHOLDER — FICTIONAL PREVIEW RECORD A',360000,
      '[120000,120000,120000]','["${createdAt}","${secondDueAt}","${thirdDueAt}"]','["fixed_term","fee_commitment"]',
      'Fictional Owner A','Owner','Fictional Company A','Fictional Owner A',1,'${createdAt}','test-fixture-${enrollmentId}','Phase D fixture','${createdAt}');

    INSERT INTO enrollments (id, client_id, project_id, agreement_id, acceptance_id, payment_plan_id, status, portal_activation_policy, next_payment_due_at, created_at, updated_at, activation_mode, onboarding_ready)
    VALUES ('${enrollmentId}','clt_preview_a','prj_preview_a','${agreementId}','${acceptanceId}','${planId}','checkout_pending','first_payment_confirmed','${createdAt}','${createdAt}','${createdAt}','manual',0);

    INSERT INTO payment_installments (id, enrollment_id, installment_number, amount, currency, due_at, status, created_at, updated_at) VALUES
      ('pay_${enrollmentId}_1','${enrollmentId}',1,120000,'usd','${createdAt}','checkout_pending','${createdAt}','${createdAt}'),
      ('pay_${enrollmentId}_2','${enrollmentId}',2,120000,'usd','${secondDueAt}','planned','${createdAt}','${createdAt}'),
      ('pay_${enrollmentId}_3','${enrollmentId}',3,120000,'usd','${thirdDueAt}','planned','${createdAt}','${createdAt}');
  `);
}

// Seeds an enrollment already in 'schedule_active' with installments 2-3 still planned and a
// live subscription linked via stripe_objects, mirroring the state phase-c.test.mjs builds for
// its replayed-invoice regression test.
function seedScheduleActive(database, { enrollmentId, subscriptionId, scheduleId, amount }) {
  const now = '2026-08-20T00:00:00.000Z';
  database.exec(`
    INSERT INTO agreements (id, client_id, project_id, status, program_name, current_version_id, accepted_version_id, expires_at, sent_at, viewed_at, accepted_at, created_at, updated_at)
    VALUES ('agr_${enrollmentId}','clt_preview_a','prj_preview_a','enrolled','90-Day Growth Program','agrv_preview_a','agrv_preview_a',NULL,'${now}','${now}','${now}','${now}','${now}');

    INSERT INTO payment_plans (id, agreement_version_id, plan_code, display_name, total_contract_value, currency, installment_count, interval_unit, interval_count, installment_schedule_json, active, created_at)
    VALUES ('plan_${enrollmentId}','agrv_preview_a','plan_${enrollmentId}','Fixed Installments',${amount * 3},'usd',3,'month',1,'[]',1,'${now}');

    INSERT INTO agreement_acceptances (id, agreement_id, agreement_version_id, client_id, project_id, payment_plan_id, legal_document_hash, rendered_agreement_snapshot, total_contract_value, installment_amounts_json, installment_dates_json, acknowledged_clause_ids_json, authorized_signer_name, authorized_signer_role, signer_company, typed_acceptance, authority_confirmed, accepted_at_utc, request_id, user_agent, created_at)
    VALUES ('acc_${enrollmentId}','agr_${enrollmentId}','agrv_preview_a','clt_preview_a','prj_preview_a','plan_${enrollmentId}','phase-c-fixture-hash-a','PHASE C LEGAL PLACEHOLDER — FICTIONAL PREVIEW RECORD A',${amount * 3},'[${amount},${amount},${amount}]','["${now}","${now}","${now}"]','["fixed_term","fee_commitment"]','Fictional Owner A','Owner','Fictional Company A','Fictional Owner A',1,'${now}','test-fixture-${enrollmentId}','Phase D fixture','${now}');

    INSERT INTO enrollments (id, client_id, project_id, agreement_id, acceptance_id, payment_plan_id, status, portal_activation_policy, next_payment_due_at, created_at, updated_at, activation_mode, onboarding_ready)
    VALUES ('${enrollmentId}','clt_preview_a','prj_preview_a','agr_${enrollmentId}','acc_${enrollmentId}','plan_${enrollmentId}','schedule_active','first_payment_confirmed','${now}','${now}','${now}','manual',0);

    INSERT INTO payment_installments (id, enrollment_id, installment_number, amount, currency, due_at, status, paid_at, created_at, updated_at) VALUES
      ('pay_${enrollmentId}_1','${enrollmentId}',1,${amount},'usd','${now}','paid','${now}','${now}','${now}'),
      ('pay_${enrollmentId}_2','${enrollmentId}',2,${amount},'usd','2030-09-01T00:00:00.000Z','planned',NULL,'${now}','${now}'),
      ('pay_${enrollmentId}_3','${enrollmentId}',3,${amount},'usd','2030-10-01T00:00:00.000Z','planned',NULL,'${now}','${now}');

    INSERT INTO stripe_objects (id, enrollment_id, stripe_object_type, stripe_object_id, livemode, status, created_at, updated_at) VALUES
      ('so_${enrollmentId}_sub','${enrollmentId}','subscription','${subscriptionId}',0,'active','${now}','${now}'),
      ('so_${enrollmentId}_sched','${enrollmentId}','subscription_schedule','${scheduleId}',0,'active','${now}','${now}');
  `);
}
