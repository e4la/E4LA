import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { verifyCloudflareAccess } from '../functions/_shared/cloudflare-access.js';
import { validateEnvironmentConfiguration, verifyDatabaseEnvironment } from '../functions/_shared/environment.js';
import { evaluatePortalActivation } from '../functions/_shared/portal-activation.js';
import { createRemainingInstallmentSchedule } from '../functions/_shared/stripe.js';
import { renderOperationsEmail } from '../functions/_shared/email-templates.js';
import { onRequestPost as handleStripeWebhook } from '../functions/api/stripe/webhook.js';
import { onRequest as handleOperationsRequest } from '../functions/api/ops/[[path]].js';
import { createSession } from '../functions/_shared/ops-security.js';

const migration1 = await readFile(new URL('../migrations/0001_client_operations.sql', import.meta.url), 'utf8');
const migration2 = await readFile(new URL('../migrations/0002_phase_c_preview.sql', import.meta.url), 'utf8');
const migration3 = await readFile(new URL('../migrations/0003_payment_plans_immutable.sql', import.meta.url), 'utf8');
const migration4 = await readFile(new URL('../migrations/0004_project_progress.sql', import.meta.url), 'utf8');
const previewFixture = await readFile(new URL('../fixtures/client-operations.preview.sql', import.meta.url), 'utf8');

test('preview schema is isolated, fixtures are fictional, and immutable evidence rejects mutation', async () => {
  const database = previewDatabase();
  assert.equal(database.prepare("SELECT setting_value FROM environment_settings WHERE setting_key='environment'").get().setting_value, 'preview');
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM clients').get().count, 6);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM clients WHERE legal_name NOT LIKE 'Fictional %'").get().count, 0);
  assert.throws(() => database.exec("UPDATE agreement_versions SET legal_document_hash='changed' WHERE id='agrv_preview_a'"), /immutable/);
  assert.throws(() => database.exec("UPDATE agreement_acceptances SET typed_acceptance='changed' WHERE id='acc_preview_b'"), /immutable/);
  database.exec("INSERT INTO audit_events (id,event_type,actor_type,created_at) VALUES ('audit_test','phase_c_test','system','2026-08-20T00:00:00.000Z')");
  assert.throws(() => database.exec("DELETE FROM audit_events WHERE id='audit_test'"), /append-only/);
  database.close();
});

test('client-visible publication boundary returns published rows only', () => {
  const database = previewDatabase();
  const visible = database.prepare("SELECT id FROM project_updates WHERE project_id='prj_preview_d' AND publication_status='published'").all();
  assert.deepEqual(visible.map((row) => row.id), ['upd_d_published']);
  const hiddenStates = database.prepare("SELECT publication_status FROM project_updates WHERE project_id='prj_preview_d' AND publication_status!='published' ORDER BY publication_status").all();
  assert.deepEqual(hiddenStates.map((row) => row.publication_status), ['approved','internal','reviewed','withdrawn']);
  database.close();
});

test('portal activation is policy-driven and requires initial payment plus onboarding readiness', async () => {
  const database = previewDatabase();
  const d1 = d1Adapter(database);
  let result = await evaluatePortalActivation(d1, 'enr_preview_c', '2026-08-20T12:00:00.000Z');
  assert.equal(result.activated, false);
  assert.equal(database.prepare("SELECT client_visible FROM projects WHERE id='prj_preview_c'").get().client_visible, 0);
  database.exec("UPDATE enrollments SET activation_mode='automatic', onboarding_ready=1 WHERE id='enr_preview_c'");
  result = await evaluatePortalActivation(d1, 'enr_preview_c', '2026-08-20T12:01:00.000Z');
  assert.equal(result.changed, true);
  assert.equal(database.prepare("SELECT client_visible FROM projects WHERE id='prj_preview_c'").get().client_visible, 1);
  assert.equal(database.prepare("SELECT access_status FROM client_users WHERE client_id='clt_preview_c'").get().access_status, 'active');
  database.close();
});

test('environment configuration fails closed across preview and production boundaries', async () => {
  const preview = {
    ENVIRONMENT: 'preview', PUBLIC_SITE_URL: 'https://e4la-client-operations-preview.pages.dev',
    ENROLLMENT_SESSION_SECRET: 'test-only', STRIPE_SECRET_KEY: 'sk_test_fixture',
    STRIPE_WEBHOOK_SECRET: 'whsec_fixture', STRIPE_API_VERSION: '2026-08-01.test',
    STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_fixture',
  };
  assert.equal(validateEnvironmentConfiguration(preview, { stripeRequired: true }).environment, 'preview');
  assert.throws(() => validateEnvironmentConfiguration({ ...preview, PUBLIC_SITE_URL: 'https://e4la.org' }), (error) => error.code === 'environment_mismatch');
  assert.throws(() => validateEnvironmentConfiguration({ ...preview, STRIPE_SECRET_KEY: 'sk_live_forbidden' }, { stripeRequired: true }), (error) => error.code === 'stripe_environment_mismatch');
  const database = previewDatabase();
  await assert.doesNotReject(verifyDatabaseEnvironment({ ...preview, ENROLLMENT_DB: d1Adapter(database) }));
  await assert.rejects(verifyDatabaseEnvironment({ ...preview, ENVIRONMENT: 'production', ENROLLMENT_DB: d1Adapter(database) }), (error) => error.code === 'database_environment_mismatch');
  database.close();
});

test('Cloudflare Access JWT validation checks signature, issuer, audience, expiry, and email', async () => {
  const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' }, true, ['sign','verify']);
  const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
  jwk.kid = 'phase-c-test-key'; jwk.alg = 'RS256'; jwk.use = 'sig';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  try {
    const now = Math.floor(Date.now() / 1000);
    const claims = { iss: 'https://phase-c-team.example/', aud: ['admin-audience'], exp: now + 300, nbf: now - 5, email: 'phase-c-admin@example.test', sub: 'fictional-subject' };
    const token = await signJwt(keys.privateKey, { alg: 'RS256', kid: jwk.kid }, claims);
    const request = new Request('https://preview.example/api/ops/auth/admin', { headers: { 'Cf-Access-Jwt-Assertion': token } });
    const identity = await verifyCloudflareAccess(request, { ACCESS_TEAM_DOMAIN: 'https://phase-c-team.example', ADMIN_ACCESS_AUD: 'admin-audience' }, 'ADMIN_ACCESS_AUD');
    assert.equal(identity.email, 'phase-c-admin@example.test');
    const wrongAudience = await signJwt(keys.privateKey, { alg: 'RS256', kid: jwk.kid }, { ...claims, aud: ['wrong'] });
    await assert.rejects(verifyCloudflareAccess(new Request(request.url, { headers: { 'Cf-Access-Jwt-Assertion': wrongAudience } }), { ACCESS_TEAM_DOMAIN: 'https://phase-c-team.example', ADMIN_ACCESS_AUD: 'admin-audience' }, 'ADMIN_ACCESS_AUD'), (error) => error.code === 'identity_expired');

    // Real Cloudflare Access JWTs carry `iss` as https://<team-domain> with NO
    // trailing slash (confirmed against a live token during the preview
    // Access rollout) - a real login was rejected as "expired" until this was
    // fixed to accept this form, not just the with-slash form asserted above.
    const noSlashIssuerToken = await signJwt(keys.privateKey, { alg: 'RS256', kid: jwk.kid }, { ...claims, iss: 'https://phase-c-team.example' });
    const noSlashIdentity = await verifyCloudflareAccess(new Request(request.url, { headers: { 'Cf-Access-Jwt-Assertion': noSlashIssuerToken } }), { ACCESS_TEAM_DOMAIN: 'https://phase-c-team.example', ADMIN_ACCESS_AUD: 'admin-audience' }, 'ADMIN_ACCESS_AUD');
    assert.equal(noSlashIdentity.email, 'phase-c-admin@example.test');
  } finally { globalThis.fetch = originalFetch; }
});

test('fixed installment schedules start at installment two and terminate after exactly N minus one iterations', async () => {
  const originalFetch = globalThis.fetch;
  const captured = [];
  globalThis.fetch = async (url, options = {}) => {
    captured.push({ url, options });
    if (String(url).includes('/payment_intents/')) return new Response(JSON.stringify({ id: 'pi_test', customer: 'cus_test', payment_method: 'pm_test', livemode: false }), { status: 200 });
    return new Response(JSON.stringify({ id: 'sub_sched_test', status: 'not_started', livemode: false }), { status: 200 });
  };
  try {
    for (const installmentCount of [3, 6]) {
      captured.length = 0;
      const dueAt = '2030-02-01T12:00:00.000Z';
      await createRemainingInstallmentSchedule(
        { STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_API_VERSION: '2026-08-01.test' },
        { id: `enr_${installmentCount}`, agreement_id: 'agr_test' },
        { installment_count: installmentCount, stripe_remaining_price_id: `price_${installmentCount}` },
        'pi_test', dueAt,
      );
      const body = captured[1].options.body;
      assert.equal(body.get('phases[0][iterations]'), String(installmentCount - 1));
      assert.equal(body.get('start_date'), String(Math.floor(new Date(dueAt).getTime() / 1000)));
      assert.equal(body.get('end_behavior'), 'cancel');
      assert.equal(body.get('default_settings[default_payment_method]'), 'pm_test');
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('replayed invoice evidence cannot advance a second installment and schedule completion fails closed', async () => {
  const database = previewDatabase();
  database.exec(`
    UPDATE enrollments SET status='schedule_active', next_payment_due_at='2030-09-03T00:00:00.000Z' WHERE id='enr_preview_b';
    INSERT INTO payment_installments (id,enrollment_id,installment_number,amount,currency,due_at,status,created_at,updated_at)
      VALUES ('pay_preview_b_2','enr_preview_b',2,120000,'usd','2030-09-03T00:00:00.000Z','planned','2026-08-20T00:00:00.000Z','2026-08-20T00:00:00.000Z'),
             ('pay_preview_b_3','enr_preview_b',3,120000,'usd','2030-10-03T00:00:00.000Z','planned','2026-08-20T00:00:00.000Z','2026-08-20T00:00:00.000Z');
    INSERT INTO stripe_objects (id,enrollment_id,stripe_object_type,stripe_object_id,livemode,status,created_at,updated_at)
      VALUES ('stripe_subscription_b','enr_preview_b','subscription','sub_preview_b',0,'active','2026-08-20T00:00:00.000Z','2026-08-20T00:00:00.000Z'),
             ('stripe_schedule_b','enr_preview_b','subscription_schedule','sched_preview_b',0,'active','2026-08-20T00:00:00.000Z','2026-08-20T00:00:00.000Z');
  `);
  const env = {
    ENVIRONMENT: 'preview', PUBLIC_SITE_URL: 'https://e4la-client-operations-preview.pages.dev',
    ENROLLMENT_SESSION_SECRET: 'preview-test-only', ENROLLMENT_DB: d1Adapter(database),
    STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture',
    STRIPE_API_VERSION: '2026-08-01.test', STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_fixture',
  };
  const invoice = { type: 'invoice.paid', data: { object: { id: 'in_replayed', subscription: 'sub_preview_b', status: 'paid', livemode: false } } };
  let response = await signedWebhook(env, { id: 'evt_invoice_first', livemode: false, ...invoice });
  assert.equal(response.status, 200);
  response = await signedWebhook(env, { id: 'evt_invoice_second', livemode: false, ...invoice });
  assert.equal(response.status, 200);
  assert.equal(database.prepare("SELECT status FROM payment_installments WHERE id='pay_preview_b_2'").get().status, 'paid');
  assert.equal(database.prepare("SELECT status FROM payment_installments WHERE id='pay_preview_b_3'").get().status, 'planned');

  response = await signedWebhook(env, { id: 'evt_schedule_early', type: 'subscription_schedule.completed', livemode: false, data: { object: { id: 'sched_preview_b', status: 'completed', livemode: false } } });
  assert.equal(response.status, 200);
  assert.equal(database.prepare("SELECT status FROM enrollments WHERE id='enr_preview_b'").get().status, 'attention_required');
  assert.equal(database.prepare("SELECT status FROM payment_installments WHERE id='pay_preview_b_3'").get().status, 'planned');
  database.close();
});

test('server sessions enforce client isolation, role limits, collaborator scope, CSRF, and activation', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const viewer = await createSession(env.ENROLLMENT_DB, {
    actorType: 'client_user', actorId: 'usr_preview_d', clientId: 'clt_preview_d', role: 'client_viewer', ttlSeconds: 3600,
  });
  let response = await operationsRequest(env, 'GET', '/api/ops/portal', viewer);
  assert.equal(response.status, 200);
  const portal = await response.json();
  assert.equal(portal.client.id, 'clt_preview_d');
  assert.notEqual(portal.client.id, 'clt_preview_e');

  response = await operationsRequest(env, 'POST', '/api/ops/billing/portal', viewer, {}, viewer.csrfToken);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'not_authorized');
  response = await operationsRequest(env, 'POST', '/api/ops/agreements/accept', viewer, {}, viewer.csrfToken);
  assert.equal(response.status, 403);

  const inactive = await createSession(env.ENROLLMENT_DB, {
    actorType: 'client_user', actorId: 'usr_preview_c', clientId: 'clt_preview_c', role: 'client_owner', ttlSeconds: 3600,
  });
  response = await operationsRequest(env, 'GET', '/api/ops/portal', inactive);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'portal_not_active');

  const collaborator = await createSession(env.ENROLLMENT_DB, {
    actorType: 'admin_user', actorId: 'adm_preview_collab', role: 'e4la_collaborator', ttlSeconds: 3600,
  });
  response = await operationsRequest(env, 'GET', '/api/ops/admin/summary', collaborator);
  assert.equal(response.status, 200);
  const summary = await response.json();
  assert.deepEqual(summary.clients.map((client) => client.id).sort(), ['clt_preview_d','clt_preview_e']);
  response = await operationsRequest(env, 'GET', '/api/ops/admin/preview/clt_preview_a', collaborator);
  assert.equal(response.status, 403);
  response = await operationsRequest(env, 'POST', '/api/ops/admin/projects/prj_preview_a/items', collaborator, {
    entityType: 'update', title: 'Forbidden', body: 'Must remain internal.',
  }, collaborator.csrfToken);
  assert.equal(response.status, 403);

  const admin = await createSession(env.ENROLLMENT_DB, {
    actorType: 'admin_user', actorId: 'adm_preview_owner', role: 'e4la_admin', ttlSeconds: 3600,
  });
  response = await operationsRequest(env, 'PATCH', '/api/ops/admin/clients/clt_forged', admin, {
    legalName: 'Fictional', displayName: 'Fictional', billingEmail: 'fictional@example.test', lifecycleStatus: 'qualified',
  }, admin.csrfToken);
  assert.equal(response.status, 404);
  response = await operationsRequest(env, 'POST', '/api/ops/admin/clients-projects', admin, {}, 'forged-csrf');
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'csrf_rejected');

  response = await operationsRequest(env, 'POST', '/api/ops/session/logout', admin, {}, admin.csrfToken);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
  response = await operationsRequest(env, 'GET', '/api/ops/admin/summary', admin);
  assert.equal(response.status, 401);

  database.prepare('UPDATE access_sessions SET revoked_at=? WHERE id=?').run(new Date().toISOString(), viewer.id);
  response = await operationsRequest(env, 'GET', '/api/ops/portal', viewer);
  assert.equal(response.status, 401);
  database.close();
});

test('Phase C source keeps browser storage, sensitive logging, and client-side authorization out', async () => {
  const browserFiles = ['../assets/js/admin.js','../assets/js/client-portal.js','../assets/js/client-agreement.js'];
  for (const file of browserFiles) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /localStorage|sessionStorage/);
  }
  const securitySource = await readFile(new URL('../functions/_shared/ops-security.js', import.meta.url), 'utf8');
  assert.doesNotMatch(securitySource, /console\.log\([^\n]*(token|signature|cookie|csrf)/i);
  const portalSource = await readFile(new URL('../functions/api/ops/[[path]].js', import.meta.url), 'utf8');
  for (const table of ['project_milestones','project_updates','deliverables','portal_documents']) {
    assert.match(portalSource, new RegExp(`${table}[^\\n]+publication_status = 'published'`));
  }
  const adminSource = await readFile(new URL('../assets/js/admin.js', import.meta.url), 'utf8');
  const clientSource = await readFile(new URL('../assets/js/client-portal.js', import.meta.url), 'utf8');
  assert.match(adminSource, /session\/logout/); assert.match(adminSource, /cdn-cgi\/access\/logout/);
  assert.match(clientSource, /session\/logout/); assert.match(clientSource, /cdn-cgi\/access\/logout/);
});

test('product preview data is confined to the isolated preview host and explicit demo mode', async () => {
  const model = await readFile(new URL('../assets/js/ops-model.js', import.meta.url), 'utf8');
  assert.match(model, /e4la-client-operations-preview\.pages\.dev/);
  assert.match(model, /get\('demo'\) === '1'/);
  assert.doesNotMatch(model, /hostname === 'e4la\.org'.*demo/s);
  for (const file of ['../client-agreement/index.html','../client-portal/index.html','../admin/index.html']) {
    const html = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.match(html, /noindex, nofollow, noarchive/);
  }
});

test('transactional email templates cover the lifecycle without sending or embedding secrets', () => {
  const types = ['agreement_invitation','agreement_accepted','payment_confirmation','payment_failure','portal_activation','onboarding_instructions'];
  for (const type of types) {
    const template = renderOperationsEmail(type, { clientName: 'Fictional Client', programName: 'Preview Program', actionUrl: 'https://preview.example/action' });
    assert.ok(template.subject);
    assert.match(template.text, /E4LA/);
    assert.match(template.html, /#07060D/);
    assert.doesNotMatch(template.html, /sk_(live|test)|whsec_|\b[0-9]{13,19}\b|cvv/i);
  }
  assert.doesNotMatch(renderOperationsEmail('agreement_invitation', { actionUrl: 'javascript:alert(1)' }).html, /javascript:/i);
});

test('admin project items start internal and portal queries remain published-only', async () => {
  const source = await readFile(new URL('../functions/api/ops/[[path]].js', import.meta.url), 'utf8');
  assert.ok(source.includes('admin\\/projects\\/([^/]+)\\/items'));
  assert.match(source, /VALUES \([^\n]+?'internal'/);
  assert.match(source, /publication_status = 'published'/);
});

function previewDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec(migration1); database.exec(migration2); database.exec(migration3); database.exec(migration4); database.exec(previewFixture);
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

async function signJwt(privateKey, header, claims) {
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedClaims = base64Url(JSON.stringify(claims));
  const input = `${encodedHeader}.${encodedClaims}`;
  const signature = await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, privateKey, new TextEncoder().encode(input));
  return `${input}.${base64Url(new Uint8Array(signature))}`;
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

function base64Url(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return Buffer.from(bytes).toString('base64url');
}
