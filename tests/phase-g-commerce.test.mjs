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
