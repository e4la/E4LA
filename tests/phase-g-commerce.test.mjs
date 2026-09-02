import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createSession } from '../functions/_shared/ops-security.js';
import { createRecurringStripeSubscription } from '../functions/_shared/stripe.js';
import { onRequest as handleCommerceRequest } from '../functions/api/commerce/[[path]].js';

// Phase G: Commerce (service catalog, quoting, flexible payments/invoicing, recurring
// service consent). Exercises functions/api/commerce/[[path]].js only through its public
// request handler, following the exact harness pattern from tests/phase-e-progress.test.mjs.

const migrationFiles = [
  '0001_client_operations.sql', '0002_phase_c_preview.sql', '0003_payment_plans_immutable.sql',
  '0004_project_progress.sql', '0005_service_catalog_and_quoting.sql',
  '0006_flexible_payments_and_invoicing.sql', '0007_recurring_service_consent.sql',
  '0008_content_intelligence.sql', '0009_publishing_and_metrics.sql',
];
const migrations = await Promise.all(migrationFiles.map((name) => readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8')));
const previewFixture = await readFile(new URL('../fixtures/client-operations.preview.sql', import.meta.url), 'utf8');
const commerceFixture = await readFile(new URL('../fixtures/commerce.preview.sql', import.meta.url), 'utf8');
const commerceRouterSource = await readFile(new URL('../functions/api/commerce/[[path]].js', import.meta.url), 'utf8');

function previewDatabase() {
  const database = new DatabaseSync(':memory:');
  migrations.forEach((sql) => database.exec(sql));
  database.exec(previewFixture);
  database.exec(commerceFixture);
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

function commerceRequest(env, method, path, session, body, csrfToken) {
  const headers = {};
  if (session) headers.Cookie = `__Host-e4la_ops=${encodeURIComponent(session.token)}`;
  if (body !== undefined) {
    headers.Origin = 'https://e4la-client-operations-preview.pages.dev';
    headers['Content-Type'] = 'application/json';
  }
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
  const request = new Request(`https://e4la-client-operations-preview.pages.dev${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return handleCommerceRequest({ request, env });
}

async function adminSession(env) {
  return createSession(env.ENROLLMENT_DB, { actorType: 'admin_user', actorId: 'adm_preview_owner', role: 'e4la_admin', ttlSeconds: 3600 });
}
async function collaboratorSession(env) {
  return createSession(env.ENROLLMENT_DB, { actorType: 'admin_user', actorId: 'adm_preview_collab', role: 'e4la_collaborator', ttlSeconds: 3600 });
}
async function ownerSession(env, clientId = 'clt_preview_d', actorId = 'usr_preview_d') {
  return createSession(env.ENROLLMENT_DB, { actorType: 'client_user', actorId, clientId, role: 'client_owner', ttlSeconds: 3600 });
}
async function signerSession(env, clientId = 'clt_preview_d', actorId = 'usr_preview_d_signer') {
  return createSession(env.ENROLLMENT_DB, { actorType: 'client_user', actorId, clientId, role: 'authorized_signer', ttlSeconds: 3600 });
}
async function viewerSession(env, clientId = 'clt_preview_d', actorId = 'usr_preview_d_viewer') {
  return createSession(env.ENROLLMENT_DB, { actorType: 'client_user', actorId, clientId, role: 'client_viewer', ttlSeconds: 3600 });
}
async function otherClientOwnerSession(env) {
  return createSession(env.ENROLLMENT_DB, { actorType: 'client_user', actorId: 'usr_preview_a', clientId: 'clt_preview_a', role: 'client_owner', ttlSeconds: 3600 });
}

// -----------------------------------------------------------------------------------
// Services / quoting core
// -----------------------------------------------------------------------------------

test('arbitrary service price accepted and used in a quote - total is exact', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const admin = await adminSession(env);
  const createServiceResponse = await commerceRequest(env, 'POST', '/api/commerce/services', admin, {
    name: 'Odd Priced Service', default_price: 284700, pricing_type: 'fixed', billing_type: 'fixed_scope',
  }, admin.csrfToken);
  assert.equal(createServiceResponse.status, 201);
  const service = await createServiceResponse.json();

  const quoteResponse = await commerceRequest(env, 'POST', '/api/commerce/clients/clt_preview_d/quotes', admin, {}, admin.csrfToken);
  assert.equal(quoteResponse.status, 201);
  const quote = await quoteResponse.json();

  const versionResponse = await commerceRequest(env, 'POST', `/api/commerce/quotes/${quote.id}/versions`, admin, {
    items: [{ service_id: service.id, quantity: 1 }],
  }, admin.csrfToken);
  assert.equal(versionResponse.status, 201);
  const version = await versionResponse.json();
  assert.equal(version.total, 284700);
  database.close();
});

test('service price override works - quote item unit_price differs from service default_price', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const admin = await adminSession(env);
  const quoteResponse = await commerceRequest(env, 'POST', '/api/commerce/clients/clt_preview_d/quotes', admin, {}, admin.csrfToken);
  const quote = await quoteResponse.json();
  const versionResponse = await commerceRequest(env, 'POST', `/api/commerce/quotes/${quote.id}/versions`, admin, {
    items: [{ service_id: 'svc_preview_1', unit_price: 500000 }],
  }, admin.csrfToken);
  assert.equal(versionResponse.status, 201);
  const version = await versionResponse.json();
  assert.equal(version.total, 500000, 'override must win over services.default_price (284700)');
  database.close();
});

test('custom service works - service_id null, hand-typed label/price', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const admin = await adminSession(env);
  const quoteResponse = await commerceRequest(env, 'POST', '/api/commerce/clients/clt_preview_d/quotes', admin, {}, admin.csrfToken);
  const quote = await quoteResponse.json();
  const versionResponse = await commerceRequest(env, 'POST', `/api/commerce/quotes/${quote.id}/versions`, admin, {
    items: [{ label: 'Custom consulting — $3,400', unit_price: 340000 }],
  }, admin.csrfToken);
  assert.equal(versionResponse.status, 201);
  const version = await versionResponse.json();
  assert.equal(version.total, 340000);
  const getResponse = await commerceRequest(env, 'GET', `/api/commerce/quotes/${quote.id}`, admin);
  const body = await getResponse.json();
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].service_id, null);
  assert.equal(body.items[0].label, 'Custom consulting — $3,400');
  database.close();
});

test('quote totals are calculated correctly with multiple items, discount, and tax', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const admin = await adminSession(env);
  const quoteResponse = await commerceRequest(env, 'POST', '/api/commerce/clients/clt_preview_d/quotes', admin, {}, admin.csrfToken);
  const quote = await quoteResponse.json();
  const versionResponse = await commerceRequest(env, 'POST', `/api/commerce/quotes/${quote.id}/versions`, admin, {
    items: [
      { service_id: 'svc_preview_1' }, // 284700
      { label: 'Custom item', unit_price: 100000, quantity: 2 }, // 200000
    ],
    discount_amount: 10000,
    tax_amount: 5000,
  }, admin.csrfToken);
  assert.equal(versionResponse.status, 201);
  const version = await versionResponse.json();
  assert.equal(version.subtotal, 484700);
  assert.equal(version.discountAmount, 10000);
  assert.equal(version.taxAmount, 5000);
  assert.equal(version.total, 479700);
  database.close();
});

test('quote creation for a draft quote moves to prepared on first version, and send requires a version', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const admin = await adminSession(env);
  const quoteResponse = await commerceRequest(env, 'POST', '/api/commerce/clients/clt_preview_d/quotes', admin, {}, admin.csrfToken);
  const quote = await quoteResponse.json();
  assert.equal(quote.status, 'draft');

  let sendResponse = await commerceRequest(env, 'POST', `/api/commerce/quotes/${quote.id}/send`, admin, {}, admin.csrfToken);
  assert.equal(sendResponse.status, 409, 'cannot send a quote with no version');

  const versionResponse = await commerceRequest(env, 'POST', `/api/commerce/quotes/${quote.id}/versions`, admin, {
    items: [{ label: 'X', unit_price: 100 }],
  }, admin.csrfToken);
  assert.equal((await versionResponse.json()).status, 'prepared');

  sendResponse = await commerceRequest(env, 'POST', `/api/commerce/quotes/${quote.id}/send`, admin, {}, admin.csrfToken);
  assert.equal(sendResponse.status, 200);
  assert.equal((await sendResponse.json()).status, 'sent');
  database.close();
});

test('quote status state machine: draft/prepared cannot jump directly to approved via /status', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const admin = await adminSession(env);
  const quoteResponse = await commerceRequest(env, 'POST', '/api/commerce/clients/clt_preview_d/quotes', admin, {}, admin.csrfToken);
  const quote = await quoteResponse.json();
  await commerceRequest(env, 'POST', `/api/commerce/quotes/${quote.id}/versions`, admin, { items: [{ label: 'X', unit_price: 100 }] }, admin.csrfToken);
  // quote.status is now 'prepared' - approved must still be rejected without going through /send.
  const response = await commerceRequest(env, 'POST', `/api/commerce/quotes/${quote.id}/status`, admin, { status: 'approved' }, admin.csrfToken);
  assert.equal(response.status, 409);
  database.close();
});

test('quote status state machine: full valid path sent -> viewed -> approved -> converted', async () => {
  // quo_preview_a is already 'sent' in the fixture.
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const admin = await adminSession(env);
  let response = await commerceRequest(env, 'POST', '/api/commerce/quotes/quo_preview_a/status', admin, { status: 'viewed' }, admin.csrfToken);
  assert.equal(response.status, 200);
  response = await commerceRequest(env, 'POST', '/api/commerce/quotes/quo_preview_a/status', admin, { status: 'approved' }, admin.csrfToken);
  assert.equal(response.status, 200);
  response = await commerceRequest(env, 'POST', '/api/commerce/quotes/quo_preview_a/status', admin, { status: 'converted' }, admin.csrfToken);
  assert.equal(response.status, 200);
  // converted is terminal
  response = await commerceRequest(env, 'POST', '/api/commerce/quotes/quo_preview_a/status', admin, { status: 'sent' }, admin.csrfToken);
  assert.equal(response.status, 409);
  database.close();
});

test('quote status state machine: sent -> rejected and sent -> expired are both valid, and both are terminal', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const admin = await adminSession(env);
  // quo_preview_a is already 'sent' in the fixture.
  let response = await commerceRequest(env, 'POST', '/api/commerce/quotes/quo_preview_a/status', admin, { status: 'rejected' }, admin.csrfToken);
  assert.equal(response.status, 200);
  // rejected is terminal - no further transition is allowed.
  response = await commerceRequest(env, 'POST', '/api/commerce/quotes/quo_preview_a/status', admin, { status: 'viewed' }, admin.csrfToken);
  assert.equal(response.status, 409);
  database.close();
});

test('quote status state machine: viewed -> expired is valid and terminal', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const admin = await adminSession(env);
  let response = await commerceRequest(env, 'POST', '/api/commerce/quotes/quo_preview_a/status', admin, { status: 'viewed' }, admin.csrfToken);
  assert.equal(response.status, 200);
  response = await commerceRequest(env, 'POST', '/api/commerce/quotes/quo_preview_a/status', admin, { status: 'expired' }, admin.csrfToken);
  assert.equal(response.status, 200);
  // expired is terminal - no further transition is allowed.
  response = await commerceRequest(env, 'POST', '/api/commerce/quotes/quo_preview_a/status', admin, { status: 'approved' }, admin.csrfToken);
  assert.equal(response.status, 409);
  database.close();
});

// -----------------------------------------------------------------------------------
// Payment options
// -----------------------------------------------------------------------------------

test('installment totals reconcile: mismatched sum is rejected 422, correct sum succeeds', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const admin = await adminSession(env);
  const quoteResponse = await commerceRequest(env, 'POST', '/api/commerce/clients/clt_preview_d/quotes', admin, {}, admin.csrfToken);
  const quote = await quoteResponse.json();
  await commerceRequest(env, 'POST', `/api/commerce/quotes/${quote.id}/versions`, admin, { items: [{ label: 'X', unit_price: 100000 }] }, admin.csrfToken);

  const bad = await commerceRequest(env, 'POST', `/api/commerce/quotes/${quote.id}/payment-options`, admin, {
    option_type: 'installments', total_amount: 100000, installment_count: 2,
    installments: [{ amount: 40000, offset_unit: 'month', offset_count: 0 }, { amount: 40000, offset_unit: 'month', offset_count: 1 }],
  }, admin.csrfToken);
  assert.equal(bad.status, 422);

  const good = await commerceRequest(env, 'POST', `/api/commerce/quotes/${quote.id}/payment-options`, admin, {
    option_type: 'installments', total_amount: 100000, installment_count: 2,
    installments: [{ amount: 50000, offset_unit: 'month', offset_count: 0 }, { amount: 50000, offset_unit: 'month', offset_count: 1 }],
  }, admin.csrfToken);
  assert.equal(good.status, 201);
  database.close();
});

test('deposit_balance sum must equal total_amount exactly - no separate fee concept', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const admin = await adminSession(env);
  const quoteResponse = await commerceRequest(env, 'POST', '/api/commerce/clients/clt_preview_d/quotes', admin, {}, admin.csrfToken);
  const quote = await quoteResponse.json();
  await commerceRequest(env, 'POST', `/api/commerce/quotes/${quote.id}/versions`, admin, { items: [{ label: 'X', unit_price: 100000 }] }, admin.csrfToken);
  const response = await commerceRequest(env, 'POST', `/api/commerce/quotes/${quote.id}/payment-options`, admin, {
    option_type: 'deposit_balance', total_amount: 100000, installment_count: 2,
    installments: [{ amount: 50000, due_date: '2026-09-01' }, { amount: 60000, due_date: '2026-10-01' }],
  }, admin.csrfToken);
  assert.equal(response.status, 422);
  database.close();
});

test('custom installment schedule works with per-installment independent due_dates', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const admin = await adminSession(env);
  const quoteResponse = await commerceRequest(env, 'POST', '/api/commerce/clients/clt_preview_d/quotes', admin, {}, admin.csrfToken);
  const quote = await quoteResponse.json();
  await commerceRequest(env, 'POST', `/api/commerce/quotes/${quote.id}/versions`, admin, { items: [{ label: 'X', unit_price: 300000 }] }, admin.csrfToken);
  const response = await commerceRequest(env, 'POST', `/api/commerce/quotes/${quote.id}/payment-options`, admin, {
    option_type: 'custom_schedule', total_amount: 300000, installment_count: 3,
    installments: [
      { amount: 100000, due_date: '2026-09-01' },
      { amount: 120000, due_date: '2026-10-15' },
      { amount: 80000, due_date: '2026-12-25' },
    ],
  }, admin.csrfToken);
  assert.equal(response.status, 201);
  const listResponse = await commerceRequest(env, 'GET', `/api/commerce/quotes/${quote.id}/payment-options`, admin);
  const body = await listResponse.json();
  const created = body.paymentOptions.find((option) => option.option_type === 'custom_schedule');
  assert.equal(created.installments.length, 3);
  assert.deepEqual(created.installments.map((i) => i.due_date), ['2026-09-01', '2026-10-15', '2026-12-25']);
  database.close();
});

test('a payment option with 0 installments is rejected', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const admin = await adminSession(env);
  const response = await commerceRequest(env, 'POST', '/api/commerce/quotes/quo_preview_a/payment-options', admin, {
    option_type: 'custom_schedule', total_amount: 100000, installment_count: 0, installments: [],
  }, admin.csrfToken);
  assert.equal(response.status, 422);
  database.close();
});

// -----------------------------------------------------------------------------------
// Structural: fixed-scope never auto-renews
// -----------------------------------------------------------------------------------

test('fixed-scope never auto-renews: the commerce router never references subscription/recurring Stripe creation from payment_options/invoices code', () => {
  // The router doesn't even import functions/_shared/stripe.js - it cannot call any Stripe
  // object-creation function (checkout, subscription, or otherwise) from any handler,
  // including the payment_options and invoices handlers, in this pass.
  assert.ok(!/from ['"].*stripe\.js['"]/.test(commerceRouterSource), 'the commerce router must not import Stripe helpers at all in this pass');
  assert.ok(!commerceRouterSource.includes('createRecurringStripeSubscription'), 'the router never calls the recurring-subscription stub itself');
  // Every remaining mention of "subscription" anywhere in the file must be confined to the
  // recurring-consent section (stripe_subscription_id storage / comments) - never appear
  // anywhere near the payment_options or invoices handlers.
  const lines = commerceRouterSource.split('\n');
  lines.forEach((line, index) => {
    if (/subscription/i.test(line)) {
      const context = lines.slice(Math.max(0, index - 2), index + 1).join(' ');
      assert.ok(/consent|recurring/i.test(context), `line ${index + 1} mentions "subscription" outside the recurring-consent context: ${line}`);
    }
  });
});

// -----------------------------------------------------------------------------------
// Recurring service consent - the safety-critical piece
// -----------------------------------------------------------------------------------

test('subscription/recurring billing requires client consent: stub throws before any Stripe call for missing/inactive consent', async () => {
  await assert.rejects(() => createRecurringStripeSubscription(null, {}), (error) => error.code === 'recurring_consent_inactive');
  await assert.rejects(() => createRecurringStripeSubscription({ status: 'cancelled' }, {}), (error) => error.code === 'recurring_consent_inactive');
  await assert.rejects(() => createRecurringStripeSubscription({ status: 'active' }, {}), (error) => error.code === 'recurring_subscription_not_implemented');
});

test('changed recurring terms require fresh consent: the immutable trigger rejects updating billing_amount/frequency', async () => {
  const database = previewDatabase();
  assert.throws(() => database.exec("UPDATE recurring_service_consents SET billing_amount = 999999 WHERE id = 'rsc_preview_a'"), /immutable/);
  assert.throws(() => database.exec("UPDATE recurring_service_consents SET billing_frequency = 'weekly' WHERE id = 'rsc_preview_a'"), /immutable/);
  assert.doesNotThrow(() => database.exec("UPDATE recurring_service_consents SET status = 'cancelled', cancelled_at = '2026-09-01T00:00:00.000Z', updated_at = '2026-09-01T00:00:00.000Z' WHERE id = 'rsc_preview_a'"));
  assert.throws(() => database.exec("DELETE FROM recurring_service_consents WHERE id = 'rsc_preview_a'"), /append-only/);
  database.close();
});

test('admin cannot forge client approval: e4la_admin session is rejected 403 on approve', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const admin = await adminSession(env);
  const response = await commerceRequest(env, 'POST', '/api/commerce/recurring-consent/approve', admin, {
    client_id: 'clt_preview_d', service_id: 'svc_preview_2', billing_amount: 150000, billing_frequency: 'monthly',
    start_date: '2026-10-01', renewal_behavior: 'auto_renew_until_cancelled',
    cancellation_terms_version: 'v1', consent_text_version: 'v1',
  }, admin.csrfToken);
  assert.equal(response.status, 403);
  database.close();
});

test('viewer cannot approve recurring billing: client_viewer session is rejected 403', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const viewer = await viewerSession(env);
  const response = await commerceRequest(env, 'POST', '/api/commerce/recurring-consent/approve', viewer, {
    client_id: 'clt_preview_d', service_id: 'svc_preview_2', billing_amount: 150000, billing_frequency: 'monthly',
    start_date: '2026-10-01', renewal_behavior: 'auto_renew_until_cancelled',
    cancellation_terms_version: 'v1', consent_text_version: 'v1',
  }, viewer.csrfToken);
  assert.equal(response.status, 403);
  database.close();
});

test('owner/authorized_signer can approve recurring consent; actor comes from session, never the body', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const signer = await signerSession(env);
  const response = await commerceRequest(env, 'POST', '/api/commerce/recurring-consent/approve', signer, {
    client_id: 'clt_preview_d', service_id: 'svc_preview_2', billing_amount: 200000, billing_frequency: 'monthly',
    start_date: '2026-10-01', renewal_behavior: 'auto_renew_until_cancelled',
    cancellation_terms_version: 'v1', consent_text_version: 'v1',
    actor_id: 'usr_preview_forged', actor_type: 'client_owner', // must be ignored - actor comes from session
  }, signer.csrfToken);
  assert.equal(response.status, 201);
  const row = database.prepare("SELECT actor_type, actor_id, consent_evidence FROM recurring_service_consents WHERE service_id = 'svc_preview_2' AND billing_amount = 200000").get();
  assert.equal(row.actor_type, 'authorized_signer');
  assert.equal(row.actor_id, 'usr_preview_d_signer');
  const evidence = JSON.parse(row.consent_evidence);
  assert.ok(evidence.requestId && evidence.userAgent !== undefined && evidence.sessionId);
  database.close();
});

test('a forged/mismatched client_id in the approve body is rejected even for a valid signer session', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const signer = await signerSession(env); // scoped to clt_preview_d
  const response = await commerceRequest(env, 'POST', '/api/commerce/recurring-consent/approve', signer, {
    client_id: 'clt_preview_a', service_id: 'svc_preview_2', billing_amount: 150000, billing_frequency: 'monthly',
    start_date: '2026-10-01', renewal_behavior: 'auto_renew_until_cancelled',
    cancellation_terms_version: 'v1', consent_text_version: 'v1',
  }, signer.csrfToken);
  assert.equal(response.status, 403);
  database.close();
});

test('forged consent ID fails with 404, not a leak, for both lookup-adjacent cancel and cross-client cancel', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const admin = await adminSession(env);
  let response = await commerceRequest(env, 'POST', '/api/commerce/recurring-consents/rsc_does_not_exist/cancel', admin, {}, admin.csrfToken);
  assert.equal(response.status, 404);

  const otherOwner = await otherClientOwnerSession(env);
  response = await commerceRequest(env, 'POST', '/api/commerce/recurring-consents/rsc_preview_a/cancel', otherOwner, {}, otherOwner.csrfToken);
  assert.equal(response.status, 404, 'cross-client cancel attempt must 404, never reveal the record exists');
  database.close();
});

test('cancelling an active consent works and cancelling again (already cancelled) is rejected, never re-activatable', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const admin = await adminSession(env);
  let response = await commerceRequest(env, 'POST', '/api/commerce/recurring-consents/rsc_preview_a/cancel', admin, {}, admin.csrfToken);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'cancelled');
  response = await commerceRequest(env, 'POST', '/api/commerce/recurring-consents/rsc_preview_a/cancel', admin, {}, admin.csrfToken);
  assert.equal(response.status, 409, 'cancelling an already-cancelled consent is a conflict, not a silent no-op success');
  // Structural: no UPDATE statement against recurring_service_consents ever sets status back
  // to 'active' - the only place 'active' is written is the initial INSERT in approveRecurringConsent.
  const updateLines = commerceRouterSource.split('\n').filter((line) => line.includes('UPDATE recurring_service_consents'));
  assert.ok(updateLines.length > 0, 'expected at least the cancel UPDATE statement to exist');
  assert.ok(updateLines.every((line) => !line.includes("'active'")), 'no UPDATE may reactivate a cancelled consent');
  database.close();
});

test('owning client_owner can cancel their own consent', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const owner = await ownerSession(env);
  const response = await commerceRequest(env, 'POST', '/api/commerce/recurring-consents/rsc_preview_a/cancel', owner, {}, owner.csrfToken);
  assert.equal(response.status, 200);
  database.close();
});

test('consent must match client/project/service/amount/frequency: missing required fields are rejected 422', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const signer = await signerSession(env);
  const response = await commerceRequest(env, 'POST', '/api/commerce/recurring-consent/approve', signer, {
    client_id: 'clt_preview_d', service_id: 'svc_preview_2', billing_amount: 150000,
    // billing_frequency, start_date, renewal_behavior, cancellation_terms_version, consent_text_version omitted
  }, signer.csrfToken);
  assert.equal(response.status, 422);
  database.close();
});

test('consent approve rejects an internally inconsistent frequency value', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const signer = await signerSession(env);
  const response = await commerceRequest(env, 'POST', '/api/commerce/recurring-consent/approve', signer, {
    client_id: 'clt_preview_d', service_id: 'svc_preview_2', billing_amount: 150000, billing_frequency: 'every-other-tuesday',
    start_date: '2026-10-01', renewal_behavior: 'auto_renew_until_cancelled',
    cancellation_terms_version: 'v1', consent_text_version: 'v1',
  }, signer.csrfToken);
  assert.equal(response.status, 422);
  database.close();
});

// -----------------------------------------------------------------------------------
// Invoices: cross-client isolation
// -----------------------------------------------------------------------------------

test('invoice belongs only to correct client: cross-client GET is 404', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const admin = await adminSession(env);
  const createResponse = await commerceRequest(env, 'POST', '/api/commerce/invoices', admin, {
    client_id: 'clt_preview_d', items: [{ label: 'X', unit_price: 10000 }],
  }, admin.csrfToken);
  assert.equal(createResponse.status, 201);
  const invoice = await createResponse.json();

  const otherOwner = await otherClientOwnerSession(env);
  const response = await commerceRequest(env, 'GET', `/api/commerce/invoices/${invoice.id}`, otherOwner);
  assert.equal(response.status, 404);
  database.close();
});

test('client cannot see another client quote or invoice - explicit cross-client isolation on both GETs', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const otherOwner = await otherClientOwnerSession(env); // clt_preview_a
  const quoteResponse = await commerceRequest(env, 'GET', '/api/commerce/quotes/quo_preview_a', otherOwner); // belongs to clt_preview_d
  assert.equal(quoteResponse.status, 404);

  const admin = await adminSession(env);
  const invoiceCreate = await commerceRequest(env, 'POST', '/api/commerce/invoices', admin, {
    client_id: 'clt_preview_d', items: [{ label: 'X', unit_price: 10000 }],
  }, admin.csrfToken);
  const invoice = await invoiceCreate.json();
  const invoiceResponse = await commerceRequest(env, 'GET', `/api/commerce/invoices/${invoice.id}`, otherOwner);
  assert.equal(invoiceResponse.status, 404);
  database.close();
});

test('the owning client can see their own quote and invoice', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const owner = await ownerSession(env);
  const quoteResponse = await commerceRequest(env, 'GET', '/api/commerce/quotes/quo_preview_a', owner);
  assert.equal(quoteResponse.status, 200);

  const admin = await adminSession(env);
  const invoiceCreate = await commerceRequest(env, 'POST', '/api/commerce/invoices', admin, {
    client_id: 'clt_preview_d', items: [{ label: 'X', unit_price: 10000 }],
  }, admin.csrfToken);
  const invoice = await invoiceCreate.json();
  const invoiceResponse = await commerceRequest(env, 'GET', `/api/commerce/invoices/${invoice.id}`, owner);
  assert.equal(invoiceResponse.status, 200);
  database.close();
});

test('invoice send transitions draft -> sent and cannot be sent twice', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const admin = await adminSession(env);
  const invoiceCreate = await commerceRequest(env, 'POST', '/api/commerce/invoices', admin, {
    client_id: 'clt_preview_d', items: [{ label: 'X', unit_price: 10000 }],
  }, admin.csrfToken);
  const invoice = await invoiceCreate.json();
  let response = await commerceRequest(env, 'POST', `/api/commerce/invoices/${invoice.id}/send`, admin, {}, admin.csrfToken);
  assert.equal(response.status, 200);
  response = await commerceRequest(env, 'POST', `/api/commerce/invoices/${invoice.id}/send`, admin, {}, admin.csrfToken);
  assert.equal(response.status, 409);
  database.close();
});

// -----------------------------------------------------------------------------------
// Authorization: viewer cannot approve financial terms
// -----------------------------------------------------------------------------------

test('viewer cannot approve financial terms: cannot transition a quote to approved, cannot create payment-options', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const viewer = await viewerSession(env);
  let response = await commerceRequest(env, 'POST', '/api/commerce/quotes/quo_preview_a/status', viewer, { status: 'approved' }, viewer.csrfToken);
  assert.equal(response.status, 403);
  response = await commerceRequest(env, 'POST', '/api/commerce/quotes/quo_preview_a/payment-options', viewer, {
    option_type: 'pay_in_full', total_amount: 624700, installment_count: 1, installments: [{ amount: 624700, due_date: '2026-09-01' }],
  }, viewer.csrfToken);
  assert.equal(response.status, 403);
  database.close();
});

test('a collaborator without project scope cannot create client-facing entities for that client', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const collaborator = await collaboratorSession(env);
  // adm_preview_collab only has access to prj_preview_d, not prj_preview_a's client.
  const response = await commerceRequest(env, 'POST', '/api/commerce/clients/clt_preview_a/quotes', collaborator, { project_id: 'prj_preview_a' }, collaborator.csrfToken);
  assert.equal(response.status, 403);
  database.close();
});

// -----------------------------------------------------------------------------------
// Server-authority: amounts and IDs cannot be manipulated by the client
// -----------------------------------------------------------------------------------

test('server rejects a manipulated amount - submitted totals are always ignored and recomputed', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const admin = await adminSession(env);
  const quoteResponse = await commerceRequest(env, 'POST', '/api/commerce/clients/clt_preview_d/quotes', admin, {}, admin.csrfToken);
  const quote = await quoteResponse.json();
  const versionResponse = await commerceRequest(env, 'POST', `/api/commerce/quotes/${quote.id}/versions`, admin, {
    items: [{ label: 'Should really cost 100', unit_price: 100, quantity: 1, amount: 999999999 }],
    subtotal: 1, total: 1, // attacker-submitted totals - must be ignored
  }, admin.csrfToken);
  assert.equal(versionResponse.status, 201);
  const version = await versionResponse.json();
  assert.equal(version.total, 100, 'server must recompute from quantity*unit_price, never trust submitted amount/subtotal/total');
  database.close();
});

test('server rejects manipulated/forged service, quote, and payment-option IDs', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const admin = await adminSession(env);

  // Forged service_id in a quote version item.
  const quoteResponse = await commerceRequest(env, 'POST', '/api/commerce/clients/clt_preview_d/quotes', admin, {}, admin.csrfToken);
  const quote = await quoteResponse.json();
  let response = await commerceRequest(env, 'POST', `/api/commerce/quotes/${quote.id}/versions`, admin, {
    items: [{ service_id: 'svc_does_not_exist', quantity: 1 }],
  }, admin.csrfToken);
  assert.equal(response.status, 404);

  // Forged quote_id.
  response = await commerceRequest(env, 'GET', '/api/commerce/quotes/quo_does_not_exist', admin);
  assert.equal(response.status, 404);

  // Forged payment_option/quote combination for payment-options creation.
  response = await commerceRequest(env, 'POST', '/api/commerce/quotes/quo_does_not_exist/payment-options', admin, {
    option_type: 'pay_in_full', total_amount: 1000, installment_count: 1, installments: [{ amount: 1000, due_date: '2026-09-01' }],
  }, admin.csrfToken);
  assert.equal(response.status, 404);

  // Forged service_id when updating a service.
  response = await commerceRequest(env, 'PATCH', '/api/commerce/services/svc_does_not_exist', admin, { name: 'X' }, admin.csrfToken);
  assert.equal(response.status, 404);
  database.close();
});

// -----------------------------------------------------------------------------------
// PR #8 parallel adversarial verification. Known defects are executable TODOs: they
// express the required secure behavior without making the branch's baseline suite red.
// Remove the todo marker when the corresponding core fix lands.
// -----------------------------------------------------------------------------------

test('quote version rows and line items remain immutable at the database boundary', () => {
  const database = previewDatabase();
  assert.throws(() => database.exec("UPDATE quote_versions SET total = 1 WHERE id = 'quov_preview_a'"), /immutable/);
  assert.throws(() => database.exec("DELETE FROM quote_versions WHERE id = 'quov_preview_a'"), /immutable/);
  assert.throws(() => database.exec("UPDATE quote_items SET unit_price = 1 WHERE id = 'qit_preview_a1'"), /immutable/);
  assert.throws(() => database.exec("DELETE FROM quote_items WHERE id = 'qit_preview_a1'"), /immutable/);
  database.close();
});

test('redirect/query parameters never mark an invoice paid', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const admin = await adminSession(env);
  const createdResponse = await commerceRequest(env, 'POST', '/api/commerce/invoices', admin, {
    client_id: 'clt_preview_d', items: [{ label: 'Server-authoritative invoice', unit_price: 25000 }],
  }, admin.csrfToken);
  const created = await createdResponse.json();

  const response = await commerceRequest(env, 'GET', `/api/commerce/invoices/${created.id}?paid=1&status=paid&redirect_status=succeeded`, admin);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.invoice.status, 'draft');
  assert.equal(payload.invoice.amount_paid, 0);
  assert.equal(payload.invoice.paid_at, null);
  database.close();
});

test('sent quote cannot silently replace the client-visible current version', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const admin = await adminSession(env);
  const before = database.prepare("SELECT current_version_id, sent_at FROM quotes WHERE id = 'quo_preview_a'").get();
  const response = await commerceRequest(env, 'POST', '/api/commerce/quotes/quo_preview_a/versions', admin, {
    items: [{ label: 'Attacker-controlled replacement', unit_price: 1 }],
  }, admin.csrfToken);
  assert.equal(response.status, 409);
  const after = database.prepare("SELECT current_version_id, sent_at FROM quotes WHERE id = 'quo_preview_a'").get();
  assert.deepEqual(after, before);
  database.close();
});

test('payment option total must match the quote current-version total', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const admin = await adminSession(env);
  const response = await commerceRequest(env, 'POST', '/api/commerce/quotes/quo_preview_a/payment-options', admin, {
    option_type: 'pay_in_full', total_amount: 1, installment_count: 1,
    installments: [{ amount: 1, due_date: '2026-09-01' }],
  }, admin.csrfToken);
  assert.equal(response.status, 422);
  database.close();
});

test('exact replay of the same approval action creates no new consent record and no new billing authorization', async () => {
  // Server-authoritative, single-use enforcement via deterministic consumption:
  // no separate persisted-offer/idempotency-key table is invented (there is no
  // fee/offer-lifecycle infrastructure to attach one to) - instead, a replay is
  // detected by comparing the incoming terms against the most recent consent
  // for this client+service. An identical replay of a still-active consent
  // must be a true no-op: zero new rows, zero new authorizations, the original
  // record completely untouched (not even superseded by its own replay).
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const signer = await signerSession(env);
  const payload = {
    client_id: 'clt_preview_d', project_id: 'prj_preview_d', service_id: 'svc_preview_2', billing_amount: 175000,
    billing_frequency: 'monthly', start_date: '2026-10-01', renewal_behavior: 'auto_renew_until_cancelled',
    cancellation_terms_version: 'v1', consent_text_version: 'v1',
  };
  const first = await commerceRequest(env, 'POST', '/api/commerce/recurring-consent/approve', signer, payload, signer.csrfToken);
  assert.equal(first.status, 201);
  const firstBody = await first.json();
  const countBefore = database.prepare(
    "SELECT COUNT(*) AS count FROM recurring_service_consents WHERE client_id = ? AND service_id = ?",
  ).get(payload.client_id, payload.service_id);

  const replay = await commerceRequest(env, 'POST', '/api/commerce/recurring-consent/approve', signer, payload, signer.csrfToken);
  assert.equal(replay.status, 200, 'an exact replay is not a new approval and must not report 201 Created');
  const replayBody = await replay.json();
  assert.equal(replayBody.id, firstBody.id, 'the replay resolves to the SAME consent record, never a new one');
  assert.equal(replayBody.replay, true);

  const countAfter = database.prepare(
    "SELECT COUNT(*) AS count FROM recurring_service_consents WHERE client_id = ? AND service_id = ?",
  ).get(payload.client_id, payload.service_id);
  assert.equal(countAfter.count, countBefore.count, 'record count must be unchanged after the replay - no new row created');

  const original = database.prepare('SELECT status, updated_at FROM recurring_service_consents WHERE id = ?').get(firstBody.id);
  assert.equal(original.status, 'active', 'the original consent remains the sole active authorization, never superseded by its own replay');

  const active = database.prepare(`SELECT COUNT(*) AS count FROM recurring_service_consents
    WHERE client_id = 'clt_preview_d' AND service_id = 'svc_preview_2' AND status = 'active'`).get();
  assert.equal(active.count, 1, 'billing authority is unchanged: exactly one active authorization, both before and after the replay');
  database.close();
});

test('changed commercial terms for an already-active consent require a new approval and correctly supersede the old one', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const signer = await signerSession(env);
  const original = {
    client_id: 'clt_preview_d', project_id: 'prj_preview_d', service_id: 'svc_preview_2', billing_amount: 175000,
    billing_frequency: 'monthly', start_date: '2026-10-01', renewal_behavior: 'auto_renew_until_cancelled',
    cancellation_terms_version: 'v1', consent_text_version: 'v1',
  };
  const first = await commerceRequest(env, 'POST', '/api/commerce/recurring-consent/approve', signer, original, signer.csrfToken);
  assert.equal(first.status, 201);
  const firstBody = await first.json();

  // A genuinely new server-created offer with a changed amount - this must be
  // treated as a real new approval, not a replay, and must require its own
  // distinct client action (this same approve() call, with the new terms).
  const changed = { ...original, billing_amount: 200000 };
  const second = await commerceRequest(env, 'POST', '/api/commerce/recurring-consent/approve', signer, changed, signer.csrfToken);
  assert.equal(second.status, 201, 'a genuine terms change is a real new approval, not a replay');
  const secondBody = await second.json();
  assert.notEqual(secondBody.id, firstBody.id);

  const originalRow = database.prepare('SELECT status FROM recurring_service_consents WHERE id = ?').get(firstBody.id);
  assert.equal(originalRow.status, 'superseded', 'the prior consent is superseded by the genuinely new, differently-termed approval');
  const active = database.prepare(`SELECT COUNT(*) AS count FROM recurring_service_consents
    WHERE client_id = 'clt_preview_d' AND service_id = 'svc_preview_2' AND status = 'active'`).get();
  assert.equal(active.count, 1, 'exactly one active authorization after a genuine terms change');
  database.close();
});

test('client-facing commerce responses omit internal notes, Stripe IDs, audit actors, and consent evidence', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const owner = await ownerSession(env);

  const quoteResponse = await commerceRequest(env, 'GET', '/api/commerce/quotes/quo_preview_a', owner);
  const quotePayload = await quoteResponse.json();
  for (const forbidden of ['notes', 'created_by_admin_id']) assert.ok(!(forbidden in quotePayload.quote));

  const consentResponse = await commerceRequest(env, 'GET', '/api/commerce/clients/clt_preview_d/recurring-consents', owner);
  const consentPayload = await consentResponse.json();
  for (const forbidden of ['consent_evidence', 'stripe_subscription_id', 'actor_id']) assert.ok(!(forbidden in consentPayload.consents[0]));
  database.close();
});

// -----------------------------------------------------------------------------------
// Adversarial validation pass (billing-safety hardening). Every test below either proves
// something already correct as a permanent regression guard, or exercises a real gap that
// was fixed in the same change as this test (see the corresponding code comment).
// -----------------------------------------------------------------------------------

// --- Services / quotes ---------------------------------------------------------------

test('service default_price: negative rejected, zero accepted as intentional free-tier business data', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const admin = await adminSession(env);
  const negative = await commerceRequest(env, 'POST', '/api/commerce/services', admin, {
    name: 'Negative Priced Service', default_price: -100, pricing_type: 'fixed', billing_type: 'fixed_scope',
  }, admin.csrfToken);
  assert.equal(negative.status, 422);
  // Zero is distinct from NULL ("always custom-priced per quote" per the 0005 schema comment) -
  // it is valid business data for a genuinely free/comp'd service tier, not invalid input.
  const zero = await commerceRequest(env, 'POST', '/api/commerce/services', admin, {
    name: 'Free Consultation', default_price: 0, pricing_type: 'fixed', billing_type: 'fixed_scope',
  }, admin.csrfToken);
  assert.equal(zero.status, 201);
  assert.equal((await zero.json()).defaultPrice, 0);
  database.close();
});

test('quote line item unit_price: negative rejected, zero accepted (a comp-d/no-charge line item)', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const admin = await adminSession(env);
  const quoteResponse = await commerceRequest(env, 'POST', '/api/commerce/clients/clt_preview_d/quotes', admin, {}, admin.csrfToken);
  const quote = await quoteResponse.json();
  const negative = await commerceRequest(env, 'POST', `/api/commerce/quotes/${quote.id}/versions`, admin, {
    items: [{ label: 'Bad', unit_price: -500 }],
  }, admin.csrfToken);
  assert.equal(negative.status, 422);
  const zero = await commerceRequest(env, 'POST', `/api/commerce/quotes/${quote.id}/versions`, admin, {
    items: [{ label: 'Comped item', unit_price: 0 }],
  }, admin.csrfToken);
  assert.equal(zero.status, 201);
  assert.equal((await zero.json()).total, 0);
  database.close();
});

test('quote currency: malformed value rejected, non-string type rejected, omitted defaults to usd, valid code normalized lowercase', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const admin = await adminSession(env);
  const bad = await commerceRequest(env, 'POST', '/api/commerce/clients/clt_preview_d/quotes', admin, { currency: 'not-a-currency' }, admin.csrfToken);
  assert.equal(bad.status, 422);
  const badType = await commerceRequest(env, 'POST', '/api/commerce/clients/clt_preview_d/quotes', admin, { currency: 12 }, admin.csrfToken);
  assert.equal(badType.status, 422, 'a non-string currency must be rejected, not coerced');
  const omitted = await commerceRequest(env, 'POST', '/api/commerce/clients/clt_preview_d/quotes', admin, {}, admin.csrfToken);
  assert.equal(omitted.status, 201);
  const omittedId = (await omitted.json()).id;
  assert.equal(database.prepare('SELECT currency FROM quotes WHERE id = ?').get(omittedId).currency, 'usd');
  const eur = await commerceRequest(env, 'POST', '/api/commerce/clients/clt_preview_d/quotes', admin, { currency: 'EUR' }, admin.csrfToken);
  assert.equal(eur.status, 201);
  const eurId = (await eur.json()).id;
  assert.equal(database.prepare('SELECT currency FROM quotes WHERE id = ?').get(eurId).currency, 'eur');
  database.close();
});

test('invoice currency: malformed value rejected, valid code normalized lowercase', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const admin = await adminSession(env);
  const bad = await commerceRequest(env, 'POST', '/api/commerce/invoices', admin, {
    client_id: 'clt_preview_d', items: [{ label: 'X', unit_price: 1000 }], currency: '$$$',
  }, admin.csrfToken);
  assert.equal(bad.status, 422);
  const good = await commerceRequest(env, 'POST', '/api/commerce/invoices', admin, {
    client_id: 'clt_preview_d', items: [{ label: 'X', unit_price: 1000 }], currency: 'GBP',
  }, admin.csrfToken);
  assert.equal(good.status, 201);
  const invoiceId = (await good.json()).id;
  assert.equal(database.prepare('SELECT currency FROM invoices WHERE id = ?').get(invoiceId).currency, 'gbp');
  database.close();
});

test('a quote-item price override never mutates the global services.default_price row', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const admin = await adminSession(env);
  const before = database.prepare('SELECT default_price FROM services WHERE id = ?').get('svc_preview_1');
  assert.equal(before.default_price, 284700);
  const quoteResponse = await commerceRequest(env, 'POST', '/api/commerce/clients/clt_preview_d/quotes', admin, {}, admin.csrfToken);
  const quote = await quoteResponse.json();
  const versionResponse = await commerceRequest(env, 'POST', `/api/commerce/quotes/${quote.id}/versions`, admin, {
    items: [{ service_id: 'svc_preview_1', unit_price: 999999 }],
  }, admin.csrfToken);
  assert.equal(versionResponse.status, 201);
  assert.equal((await versionResponse.json()).total, 999999);
  const after = database.prepare('SELECT default_price FROM services WHERE id = ?').get('svc_preview_1');
  assert.equal(after.default_price, 284700, 'services.default_price must remain the untouched catalog price - unit_price on quote_items is a snapshot, never a live join');
  database.close();
});

test('a custom line item (service_id null) survives quote versioning: the prior version stays intact when a new version is created', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const admin = await adminSession(env);
  const quoteResponse = await commerceRequest(env, 'POST', '/api/commerce/clients/clt_preview_d/quotes', admin, {}, admin.csrfToken);
  const quote = await quoteResponse.json();
  const v1 = await (await commerceRequest(env, 'POST', `/api/commerce/quotes/${quote.id}/versions`, admin, {
    items: [{ label: 'Custom scope item v1', unit_price: 50000 }],
  }, admin.csrfToken)).json();
  const v2 = await (await commerceRequest(env, 'POST', `/api/commerce/quotes/${quote.id}/versions`, admin, {
    items: [{ label: 'Custom scope item v2', unit_price: 75000 }],
  }, admin.csrfToken)).json();
  assert.notEqual(v1.id, v2.id);
  const getResponse = await commerceRequest(env, 'GET', `/api/commerce/quotes/${quote.id}`, admin);
  const body = await getResponse.json();
  assert.equal(body.version.id, v2.id);
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].label, 'Custom scope item v2');
  const v1Items = database.prepare('SELECT label, service_id, unit_price FROM quote_items WHERE quote_version_id = ?').all(v1.id);
  assert.equal(v1Items.length, 1);
  assert.equal(v1Items[0].label, 'Custom scope item v1');
  assert.equal(v1Items[0].service_id, null);
  assert.equal(v1Items[0].unit_price, 50000);
  database.close();
});

test('an already-sent quote version cannot be silently mutated: the DB trigger fires and the row is byte-for-byte unchanged after the attempt', () => {
  const database = previewDatabase();
  const quoteBefore = database.prepare("SELECT status FROM quotes WHERE id = 'quo_preview_a'").get();
  assert.equal(quoteBefore.status, 'sent', 'this fixture quote is already sent - exactly the already-approved/sent scenario');
  const before = database.prepare("SELECT total, subtotal FROM quote_versions WHERE id = 'quov_preview_a'").get();
  assert.throws(() => database.exec("UPDATE quote_versions SET total = 1, subtotal = 1 WHERE id = 'quov_preview_a'"), /immutable/);
  const after = database.prepare("SELECT total, subtotal FROM quote_versions WHERE id = 'quov_preview_a'").get();
  assert.deepEqual(after, before, 'the row must be completely unchanged after the rejected UPDATE, not partially applied');
  database.close();
});

// --- Payment options / installments ---------------------------------------------------

test('installment rounding: 333/333/334 (exact) succeeds, 333/333/333 (off by one) is rejected', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const admin = await adminSession(env);
  const quoteResponse = await commerceRequest(env, 'POST', '/api/commerce/clients/clt_preview_d/quotes', admin, {}, admin.csrfToken);
  const quote = await quoteResponse.json();
  await commerceRequest(env, 'POST', `/api/commerce/quotes/${quote.id}/versions`, admin, { items: [{ label: 'X', unit_price: 1000 }] }, admin.csrfToken);
  const rejected = await commerceRequest(env, 'POST', `/api/commerce/quotes/${quote.id}/payment-options`, admin, {
    option_type: 'installments', total_amount: 1000, installment_count: 3,
    installments: [
      { amount: 333, offset_unit: 'month', offset_count: 0 },
      { amount: 333, offset_unit: 'month', offset_count: 1 },
      { amount: 333, offset_unit: 'month', offset_count: 2 },
    ],
  }, admin.csrfToken);
  assert.equal(rejected.status, 422);
  const accepted = await commerceRequest(env, 'POST', `/api/commerce/quotes/${quote.id}/payment-options`, admin, {
    option_type: 'installments', total_amount: 1000, installment_count: 3,
    installments: [
      { amount: 333, offset_unit: 'month', offset_count: 0 },
      { amount: 333, offset_unit: 'month', offset_count: 1 },
      { amount: 334, offset_unit: 'month', offset_count: 2 },
    ],
  }, admin.csrfToken);
  assert.equal(accepted.status, 201);
  database.close();
});

test('pay_in_full requires exactly one installment: 1 succeeds, 2 is rejected', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const admin = await adminSession(env);
  const quoteResponse = await commerceRequest(env, 'POST', '/api/commerce/clients/clt_preview_d/quotes', admin, {}, admin.csrfToken);
  const quote = await quoteResponse.json();
  await commerceRequest(env, 'POST', `/api/commerce/quotes/${quote.id}/versions`, admin, { items: [{ label: 'X', unit_price: 50000 }] }, admin.csrfToken);
  const one = await commerceRequest(env, 'POST', `/api/commerce/quotes/${quote.id}/payment-options`, admin, {
    option_type: 'pay_in_full', total_amount: 50000, installment_count: 1,
    installments: [{ amount: 50000, due_date: '2026-09-15' }],
  }, admin.csrfToken);
  assert.equal(one.status, 201);
  const two = await commerceRequest(env, 'POST', `/api/commerce/quotes/${quote.id}/payment-options`, admin, {
    option_type: 'pay_in_full', total_amount: 50000, installment_count: 2,
    installments: [{ amount: 25000, due_date: '2026-09-15' }, { amount: 25000, due_date: '2026-10-15' }],
  }, admin.csrfToken);
  assert.equal(two.status, 422);
  database.close();
});

test('an irregular custom installment schedule (uneven amounts, mixed due_date and offset_unit) succeeds when the sum is exact', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const admin = await adminSession(env);
  const quoteResponse = await commerceRequest(env, 'POST', '/api/commerce/clients/clt_preview_d/quotes', admin, {}, admin.csrfToken);
  const quote = await quoteResponse.json();
  await commerceRequest(env, 'POST', `/api/commerce/quotes/${quote.id}/versions`, admin, { items: [{ label: 'X', unit_price: 275000 }] }, admin.csrfToken);
  const response = await commerceRequest(env, 'POST', `/api/commerce/quotes/${quote.id}/payment-options`, admin, {
    option_type: 'custom_schedule', total_amount: 275000, installment_count: 3,
    installments: [
      { amount: 100000, due_date: '2026-09-10' },
      { amount: 50000, offset_unit: 'week', offset_count: 2 },
      { amount: 125000, offset_unit: 'day', offset_count: 45 },
    ],
  }, admin.csrfToken);
  assert.equal(response.status, 201);
  database.close();
});

test('PAYMENT_OPTION_COUNTS enforces the right installment count per option_type: deposit_balance rejects 1 or 3, accepts 2', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const admin = await adminSession(env);
  const quoteResponse = await commerceRequest(env, 'POST', '/api/commerce/clients/clt_preview_d/quotes', admin, {}, admin.csrfToken);
  const quote = await quoteResponse.json();
  await commerceRequest(env, 'POST', `/api/commerce/quotes/${quote.id}/versions`, admin, { items: [{ label: 'X', unit_price: 90000 }] }, admin.csrfToken);
  const oneInstallment = await commerceRequest(env, 'POST', `/api/commerce/quotes/${quote.id}/payment-options`, admin, {
    option_type: 'deposit_balance', total_amount: 90000, installment_count: 1,
    installments: [{ amount: 90000, due_date: '2026-09-15' }],
  }, admin.csrfToken);
  assert.equal(oneInstallment.status, 422);
  const threeInstallments = await commerceRequest(env, 'POST', `/api/commerce/quotes/${quote.id}/payment-options`, admin, {
    option_type: 'deposit_balance', total_amount: 90000, installment_count: 3,
    installments: [{ amount: 30000, due_date: '2026-09-15' }, { amount: 30000, due_date: '2026-10-15' }, { amount: 30000, due_date: '2026-11-15' }],
  }, admin.csrfToken);
  assert.equal(threeInstallments.status, 422);
  const twoInstallments = await commerceRequest(env, 'POST', `/api/commerce/quotes/${quote.id}/payment-options`, admin, {
    option_type: 'deposit_balance', total_amount: 90000, installment_count: 2,
    installments: [{ amount: 45000, due_date: '2026-09-15' }, { amount: 45000, due_date: '2026-10-15' }],
  }, admin.csrfToken);
  assert.equal(twoInstallments.status, 201);
  database.close();
});

test('payment_options are admin-only: client_owner and authorized_signer sessions are rejected 403', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const owner = await ownerSession(env);
  const signer = await signerSession(env);
  const payload = {
    option_type: 'pay_in_full', total_amount: 624700, installment_count: 1,
    installments: [{ amount: 624700, due_date: '2026-09-01' }],
  };
  const ownerResponse = await commerceRequest(env, 'POST', '/api/commerce/quotes/quo_preview_a/payment-options', owner, payload, owner.csrfToken);
  assert.equal(ownerResponse.status, 403);
  const signerResponse = await commerceRequest(env, 'POST', '/api/commerce/quotes/quo_preview_a/payment-options', signer, payload, signer.csrfToken);
  assert.equal(signerResponse.status, 403);
  database.close();
});

test('installment_count must equal the actual installments array length (regression)', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const admin = await adminSession(env);
  const quoteResponse = await commerceRequest(env, 'POST', '/api/commerce/clients/clt_preview_d/quotes', admin, {}, admin.csrfToken);
  const quote = await quoteResponse.json();
  await commerceRequest(env, 'POST', `/api/commerce/quotes/${quote.id}/versions`, admin, { items: [{ label: 'X', unit_price: 100000 }] }, admin.csrfToken);
  const response = await commerceRequest(env, 'POST', `/api/commerce/quotes/${quote.id}/payment-options`, admin, {
    option_type: 'installments', total_amount: 100000, installment_count: 3,
    installments: [{ amount: 50000, offset_unit: 'month', offset_count: 0 }, { amount: 50000, offset_unit: 'month', offset_count: 1 }],
  }, admin.csrfToken);
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, 'installment_count_mismatch');
  database.close();
});

test('submitting the identical payment-option payload twice creates two independent rows - a quote may legitimately offer the same option twice, and this is not deduplicated', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const admin = await adminSession(env);
  const quoteResponse = await commerceRequest(env, 'POST', '/api/commerce/clients/clt_preview_d/quotes', admin, {}, admin.csrfToken);
  const quote = await quoteResponse.json();
  await commerceRequest(env, 'POST', `/api/commerce/quotes/${quote.id}/versions`, admin, { items: [{ label: 'X', unit_price: 60000 }] }, admin.csrfToken);
  const payload = { option_type: 'pay_in_full', total_amount: 60000, installment_count: 1, installments: [{ amount: 60000, due_date: '2026-09-15' }] };
  const first = await commerceRequest(env, 'POST', `/api/commerce/quotes/${quote.id}/payment-options`, admin, payload, admin.csrfToken);
  const second = await commerceRequest(env, 'POST', `/api/commerce/quotes/${quote.id}/payment-options`, admin, payload, admin.csrfToken);
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.notEqual((await first.json()).id, (await second.json()).id);
  const count = database.prepare('SELECT COUNT(*) AS count FROM payment_options WHERE quote_id = ? AND option_type = ?').get(quote.id, 'pay_in_full');
  assert.equal(count.count, 2, 'two independent rows exist - intentional (a quote can offer multiple payment choices to a client), not silently deduplicated');
  database.close();
});

// --- Recurring service consent ---------------------------------------------------------

test('a recurring consent cannot be created for a fixed_scope service', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const signer = await signerSession(env);
  const response = await commerceRequest(env, 'POST', '/api/commerce/recurring-consent/approve', signer, {
    client_id: 'clt_preview_d', service_id: 'svc_preview_1', billing_amount: 100000, billing_frequency: 'monthly',
    start_date: '2026-10-01', renewal_behavior: 'auto_renew_until_cancelled',
    cancellation_terms_version: 'v1', consent_text_version: 'v1',
  }, signer.csrfToken);
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, 'service_not_recurring');
  const count = database.prepare("SELECT COUNT(*) AS count FROM recurring_service_consents WHERE service_id = 'svc_preview_1'").get();
  assert.equal(count.count, 0, 'no consent row was ever written for the fixed_scope service');
  database.close();
});

test('a collaborator session cannot create a recurring consent on behalf of a client', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const collaborator = await collaboratorSession(env);
  const response = await commerceRequest(env, 'POST', '/api/commerce/recurring-consent/approve', collaborator, {
    client_id: 'clt_preview_d', service_id: 'svc_preview_2', billing_amount: 150000, billing_frequency: 'monthly',
    start_date: '2026-10-01', renewal_behavior: 'auto_renew_until_cancelled',
    cancellation_terms_version: 'v1', consent_text_version: 'v1',
  }, collaborator.csrfToken);
  assert.equal(response.status, 403);
  database.close();
});

test('approving a new recurring consent supersedes the prior active consent for the same client+service, leaving its terms untouched', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const signer = await signerSession(env);
  const priorBefore = database.prepare("SELECT status, billing_amount, billing_frequency, updated_at FROM recurring_service_consents WHERE id = 'rsc_preview_a'").get();
  assert.equal(priorBefore.status, 'active');
  const response = await commerceRequest(env, 'POST', '/api/commerce/recurring-consent/approve', signer, {
    client_id: 'clt_preview_d', service_id: 'svc_preview_2', billing_amount: 175000, billing_frequency: 'monthly',
    start_date: '2026-11-01', renewal_behavior: 'auto_renew_until_cancelled',
    cancellation_terms_version: 'v2', consent_text_version: 'v2',
  }, signer.csrfToken);
  assert.equal(response.status, 201);
  const newConsent = await response.json();
  const priorAfter = database.prepare("SELECT status, billing_amount, billing_frequency, updated_at FROM recurring_service_consents WHERE id = 'rsc_preview_a'").get();
  assert.equal(priorAfter.status, 'superseded', 'the old consent for this client+service must be retired, never left active alongside the new one');
  // (b) the superseded row's actual agreed-to terms remain untouched - only status/updated_at changed.
  assert.equal(priorAfter.billing_amount, priorBefore.billing_amount);
  assert.equal(priorAfter.billing_frequency, priorBefore.billing_frequency);
  assert.notEqual(priorAfter.updated_at, priorBefore.updated_at);
  const newRow = database.prepare('SELECT status, billing_amount FROM recurring_service_consents WHERE id = ?').get(newConsent.id);
  assert.equal(newRow.status, 'active');
  assert.equal(newRow.billing_amount, 175000);
  const activeCount = database.prepare("SELECT COUNT(*) AS count FROM recurring_service_consents WHERE client_id = 'clt_preview_d' AND service_id = 'svc_preview_2' AND status = 'active'").get();
  assert.equal(activeCount.count, 1, 'exactly one active consent must exist for this client+service after the supersede');
  database.close();
});

test('a superseded consent row remains protected by the immutable-terms trigger', () => {
  const database = previewDatabase();
  database.exec("UPDATE recurring_service_consents SET status = 'superseded', updated_at = '2026-09-01T00:00:00.000Z' WHERE id = 'rsc_preview_a'");
  assert.throws(() => database.exec("UPDATE recurring_service_consents SET billing_amount = 1 WHERE id = 'rsc_preview_a'"), /immutable/);
  database.close();
});

test('a cancelled consent is never mistakenly reactivated or resuperseded by a later, unrelated approval', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const signer = await signerSession(env);
  database.exec("UPDATE recurring_service_consents SET status = 'cancelled', cancelled_at = '2026-08-30T00:00:00.000Z', updated_at = '2026-08-30T00:00:00.000Z' WHERE id = 'rsc_preview_a'");
  const response = await commerceRequest(env, 'POST', '/api/commerce/recurring-consent/approve', signer, {
    client_id: 'clt_preview_d', service_id: 'svc_preview_2', billing_amount: 200000, billing_frequency: 'monthly',
    start_date: '2026-10-01', renewal_behavior: 'auto_renew_until_cancelled',
    cancellation_terms_version: 'v1', consent_text_version: 'v1',
  }, signer.csrfToken);
  assert.equal(response.status, 201);
  const stillCancelled = database.prepare("SELECT status FROM recurring_service_consents WHERE id = 'rsc_preview_a'").get();
  assert.equal(stillCancelled.status, 'cancelled', 'a cancelled consent must never be flipped back to active or superseded by a later, unrelated approval');
  const newRow = database.prepare('SELECT status FROM recurring_service_consents WHERE id = ?').get((await response.json()).id);
  assert.equal(newRow.status, 'active');
  database.close();
});

test('replaying an identical recurring-consent approval back-to-back results in exactly one row, not two', async () => {
  // Server-authoritative single-use enforcement: an exact replay must resolve
  // to the SAME record (200, no new row) rather than being treated as a new,
  // superseding approval - creating a second row for a byte-identical replay
  // is exactly the defect this test exists to catch.
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const signer = await signerSession(env);
  const payload = {
    client_id: 'clt_preview_d', service_id: 'svc_preview_2', billing_amount: 210000, billing_frequency: 'monthly',
    start_date: '2026-11-01', renewal_behavior: 'auto_renew_until_cancelled',
    cancellation_terms_version: 'v3', consent_text_version: 'v3',
  };
  const first = await commerceRequest(env, 'POST', '/api/commerce/recurring-consent/approve', signer, payload, signer.csrfToken);
  const replay = await commerceRequest(env, 'POST', '/api/commerce/recurring-consent/approve', signer, payload, signer.csrfToken);
  assert.equal(first.status, 201);
  assert.equal(replay.status, 200, 'an exact replay must resolve to the existing consent, never report 201 Created');
  const firstBody = await first.json();
  const replayBody = await replay.json();
  assert.equal(firstBody.id, replayBody.id, 'replay resolves to the same record - no second row is ever created');
  const rows = database.prepare("SELECT id, status FROM recurring_service_consents WHERE client_id = 'clt_preview_d' AND service_id = 'svc_preview_2' AND billing_amount = 210000").all();
  assert.equal(rows.length, 1, 'exactly one row total for this client+service+terms - the replay created nothing');
  assert.equal(rows[0].status, 'active', 'the sole row remains active, never superseded by its own replay');
  database.close();
});

test('fixed-scope payment schedules are structurally finite: payment_options/payment_option_installments have no renewal column', () => {
  const database = previewDatabase();
  const optionColumns = database.prepare('PRAGMA table_info(payment_options)').all().map((c) => c.name);
  const installmentColumns = database.prepare('PRAGMA table_info(payment_option_installments)').all().map((c) => c.name);
  for (const column of [...optionColumns, ...installmentColumns]) {
    assert.ok(!/renew/i.test(column), `unexpected renewal-related column "${column}" - fixed-scope schedules must remain a finite, enumerated list of installments`);
  }
  assert.ok(!optionColumns.includes('renewal_behavior'), 'renewal_behavior belongs only to recurring_service_consents, never to payment_options');
  database.close();
});

// --- Invoices ---------------------------------------------------------------------------

test('createInvoice ignores a client-submitted top-level total/subtotal/amount_paid/status and always recomputes from items', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const admin = await adminSession(env);
  const response = await commerceRequest(env, 'POST', '/api/commerce/invoices', admin, {
    client_id: 'clt_preview_d', items: [{ label: 'Real cost is 500', unit_price: 500 }],
    total: 999999999, subtotal: 999999999, amount_paid: 999999999, status: 'paid',
  }, admin.csrfToken);
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.total, 500);
  assert.equal(body.subtotal, 500);
  const row = database.prepare('SELECT total, subtotal, amount_paid, status FROM invoices WHERE id = ?').get(body.id);
  assert.equal(row.total, 500);
  assert.equal(row.subtotal, 500);
  assert.equal(row.amount_paid, 0, 'amount_paid can never be set at creation time, regardless of what the client submits');
  assert.equal(row.status, 'draft', 'status can never be set to paid at creation time via a client-submitted field');
  database.close();
});

test('a forged/nonexistent quote_id on invoice creation is rejected 404', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const admin = await adminSession(env);
  const response = await commerceRequest(env, 'POST', '/api/commerce/invoices', admin, {
    client_id: 'clt_preview_d', quote_id: 'quo_does_not_exist', items: [{ label: 'X', unit_price: 1000 }],
  }, admin.csrfToken);
  assert.equal(response.status, 404);
  database.close();
});

test('a forged/nonexistent service_id on an invoice line item is rejected 404', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const admin = await adminSession(env);
  const response = await commerceRequest(env, 'POST', '/api/commerce/invoices', admin, {
    client_id: 'clt_preview_d', items: [{ service_id: 'svc_does_not_exist', quantity: 1 }],
  }, admin.csrfToken);
  assert.equal(response.status, 404);
  database.close();
});

test('client_viewer cannot create or send invoices, but can still read them - viewer is read-only, not locked out', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const viewer = await viewerSession(env);
  const createResponse = await commerceRequest(env, 'POST', '/api/commerce/invoices', viewer, {
    client_id: 'clt_preview_d', items: [{ label: 'X', unit_price: 1000 }],
  }, viewer.csrfToken);
  assert.equal(createResponse.status, 403);
  const admin = await adminSession(env);
  const invoice = await (await commerceRequest(env, 'POST', '/api/commerce/invoices', admin, {
    client_id: 'clt_preview_d', items: [{ label: 'X', unit_price: 1000 }],
  }, admin.csrfToken)).json();
  const sendResponse = await commerceRequest(env, 'POST', `/api/commerce/invoices/${invoice.id}/send`, viewer, {}, viewer.csrfToken);
  assert.equal(sendResponse.status, 403);
  const readResponse = await commerceRequest(env, 'GET', `/api/commerce/invoices/${invoice.id}`, viewer);
  assert.equal(readResponse.status, 200);
  database.close();
});

test('client-role invoice responses omit internal admin/Stripe fields on both getInvoice and listClientInvoices; admin still sees them', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const admin = await adminSession(env);
  const invoice = await (await commerceRequest(env, 'POST', '/api/commerce/invoices', admin, {
    client_id: 'clt_preview_d', items: [{ label: 'X', unit_price: 1000 }],
  }, admin.csrfToken)).json();
  // Stamp in fake Stripe object ids directly so the test proves they are dropped for a
  // client session, not merely absent because none were ever set.
  database.prepare('UPDATE invoices SET stripe_invoice_id = ?, stripe_payment_intent_id = ? WHERE id = ?')
    .run('in_fake_test_id', 'pi_fake_test_id', invoice.id);

  const owner = await ownerSession(env);
  const ownerGetBody = await (await commerceRequest(env, 'GET', `/api/commerce/invoices/${invoice.id}`, owner)).json();
  for (const forbidden of ['created_by_admin_id', 'stripe_invoice_id', 'stripe_payment_intent_id']) {
    assert.ok(!(forbidden in ownerGetBody.invoice), `getInvoice leaked "${forbidden}" to a client session`);
  }
  assert.equal(ownerGetBody.invoice.id, invoice.id);
  assert.equal(ownerGetBody.invoice.total, 1000);

  const ownerListBody = await (await commerceRequest(env, 'GET', '/api/commerce/clients/clt_preview_d/invoices', owner)).json();
  const listed = ownerListBody.invoices.find((row) => row.id === invoice.id);
  for (const forbidden of ['created_by_admin_id', 'stripe_invoice_id', 'stripe_payment_intent_id']) {
    assert.ok(!(forbidden in listed), `listClientInvoices leaked "${forbidden}" to a client session`);
  }

  const adminGetBody = await (await commerceRequest(env, 'GET', `/api/commerce/invoices/${invoice.id}`, admin)).json();
  assert.equal(adminGetBody.invoice.stripe_invoice_id, 'in_fake_test_id');
  assert.equal(adminGetBody.invoice.created_by_admin_id, 'adm_preview_owner');
  database.close();
});
