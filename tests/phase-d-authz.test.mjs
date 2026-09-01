import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createSession, sha256 } from '../functions/_shared/ops-security.js';
import { onRequest as handleOperationsRequest } from '../functions/api/ops/[[path]].js';

// Phase D extends Phase C's authorization/session-security regression coverage.
// It intentionally avoids re-testing scenarios already proven in tests/phase-c.test.mjs
// (basic viewer/collaborator role rejection, CSRF-forged admin mutation, session
// revocation-then-401, logout cookie clearing, and the DB-level publication grep).

const migration1 = await readFile(new URL('../migrations/0001_client_operations.sql', import.meta.url), 'utf8');
const migration2 = await readFile(new URL('../migrations/0002_phase_c_preview.sql', import.meta.url), 'utf8');
const migration3 = await readFile(new URL('../migrations/0003_payment_plans_immutable.sql', import.meta.url), 'utf8');
const previewFixture = await readFile(new URL('../fixtures/client-operations.preview.sql', import.meta.url), 'utf8');

test('E4LA Admin authorization: admin succeeds on admin-only routes; missing session and non-admin roles are rejected', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);

  const admin = await createSession(env.ENROLLMENT_DB, {
    actorType: 'admin_user', actorId: 'adm_preview_owner', role: 'e4la_admin', ttlSeconds: 3600,
  });
  let response = await operationsRequest(env, 'POST', '/api/ops/admin/clients-projects', admin, {
    legalName: 'Fictional Newco LLC', displayName: 'Newco', ownerEmail: 'owner+newco@example.test',
    ownerName: 'Fictional Owner Newco', projectName: 'Newco Growth Program',
  }, admin.csrfToken);
  assert.equal(response.status, 201);
  const created = await response.json();
  assert.match(created.clientId, /^clt_/);
  assert.match(created.projectId, /^prj_/);

  response = await handleOperationsRequest({
    request: new Request('https://e4la-client-operations-preview.pages.dev/api/ops/admin/summary'), env,
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, 'authentication_required');

  const owner = await createSession(env.ENROLLMENT_DB, {
    actorType: 'client_user', actorId: 'usr_preview_d', clientId: 'clt_preview_d', role: 'client_owner', ttlSeconds: 3600,
  });
  response = await operationsRequest(env, 'GET', '/api/ops/admin/summary', owner);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'not_authorized');
  database.close();
});

test('E4LA Collaborator project scoping: allowed within an assigned project, denied outside it', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const admin = await createSession(env.ENROLLMENT_DB, {
    actorType: 'admin_user', actorId: 'adm_preview_owner', role: 'e4la_admin', ttlSeconds: 3600,
  });
  const collaborator = await createSession(env.ENROLLMENT_DB, {
    actorType: 'admin_user', actorId: 'adm_preview_collab', role: 'e4la_collaborator', ttlSeconds: 3600,
  });

  // adm_preview_collab has 'manager' access to prj_preview_e (see fixtures) -> create + publish must succeed.
  let response = await operationsRequest(env, 'POST', '/api/ops/admin/projects/prj_preview_e/items', collaborator, {
    entityType: 'update', title: 'Fictional scoped update', body: 'Collaborator authoring within assigned scope.',
  }, collaborator.csrfToken);
  assert.equal(response.status, 201);
  const scoped = await response.json();
  assert.equal(scoped.publicationStatus, 'internal');

  response = await operationsRequest(env, 'POST', '/api/ops/admin/publication', collaborator, {
    entityType: 'update', entityId: scoped.id, publicationStatus: 'published',
  }, collaborator.csrfToken);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).publicationStatus, 'published');

  // adm_preview_collab has no admin_project_access row for prj_preview_a -> both actions must be denied.
  const outOfScopeItem = await operationsRequest(env, 'POST', '/api/ops/admin/projects/prj_preview_a/items', admin, {
    entityType: 'update', title: 'Admin-authored item', body: 'Created by admin on an unassigned project.',
  }, admin.csrfToken);
  assert.equal(outOfScopeItem.status, 201);
  const outOfScope = await outOfScopeItem.json();

  response = await operationsRequest(env, 'POST', '/api/ops/admin/projects/prj_preview_a/items', collaborator, {
    entityType: 'update', title: 'Forbidden', body: 'Must not be created.',
  }, collaborator.csrfToken);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'not_authorized');

  response = await operationsRequest(env, 'POST', '/api/ops/admin/publication', collaborator, {
    entityType: 'update', entityId: outOfScope.id, publicationStatus: 'published',
  }, collaborator.csrfToken);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'not_authorized');
  database.close();
});

test('Client Owner/Authorized Signer can reach own-client agreement and billing; unaffiliated Client Viewer cannot start checkout', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);

  // Own-client agreement access via an invite-issued signer session (agr_preview_a belongs to clt_preview_a).
  const token = 'phase-d-owner-agreement-token';
  const tokenHash = await sha256(token);
  const now = new Date().toISOString();
  database.prepare(`INSERT INTO agreement_invites (id, agreement_id, agreement_version_id, intended_email_normalized, token_hash, expires_at, created_by_admin_id, created_at)
    VALUES (?, 'agr_preview_a', 'agrv_preview_a', 'owner+a@example.test', ?, ?, 'adm_preview_owner', ?)`)
    .run('inv_phase_d_owner', tokenHash, new Date(Date.now() + 3600_000).toISOString(), now);
  let response = await rawRequest(env, 'POST', '/api/ops/invites/exchange', {
    body: { agreementId: 'agr_preview_a', inviteToken: token },
  });
  assert.equal(response.status, 200);
  const signerCookie = extractSessionCookie(response);
  response = await rawRequest(env, 'GET', '/api/ops/agreements/current', { cookie: signerCookie });
  assert.equal(response.status, 200);
  const agreementPayload = await response.json();
  assert.equal(agreementPayload.agreement.id, 'agr_preview_a');
  assert.equal(agreementPayload.client.legalBusinessName, 'Fictional Alder Studio LLC');

  // Own-client billing portal access for an authorized client_owner session (clt_preview_d has an enrollment).
  database.prepare(`INSERT INTO stripe_objects (id, enrollment_id, stripe_object_type, stripe_object_id, livemode, status, metadata_json, created_at, updated_at)
    VALUES (?, 'enr_preview_d', 'customer', 'cus_fictional_d', 0, 'active', '{}', ?, ?)`).run('stripe_cust_d', now, now);
  const owner = await createSession(env.ENROLLMENT_DB, {
    actorType: 'client_user', actorId: 'usr_preview_d', clientId: 'clt_preview_d', role: 'client_owner', ttlSeconds: 3600,
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /billing_portal\/sessions/);
    return new Response(JSON.stringify({ id: 'bps_fictional', url: 'https://billing.stripe.example/session/fictional', livemode: false }), { status: 200 });
  };
  try {
    response = await operationsRequest(env, 'POST', '/api/ops/billing/portal', owner, {}, owner.csrfToken);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).portalUrl, 'https://billing.stripe.example/session/fictional');
  } finally {
    globalThis.fetch = originalFetch;
  }

  // Client Viewer restrictions already cover accept/billing-portal (phase-c); extend to checkout.
  const viewer = await createSession(env.ENROLLMENT_DB, {
    actorType: 'client_user', actorId: 'usr_preview_d', clientId: 'clt_preview_d', role: 'client_viewer', ttlSeconds: 3600,
  });
  response = await operationsRequest(env, 'POST', '/api/ops/checkout', viewer, {}, viewer.csrfToken);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'not_authorized');
  database.close();
});

test('Invite tokens cannot be replayed and a mismatched agreement/token pairing is rejected without leaking or consuming the real invite', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const now = new Date().toISOString();
  const future = new Date(Date.now() + 3600_000).toISOString();

  const replayToken = 'phase-d-replay-token';
  database.prepare(`INSERT INTO agreement_invites (id, agreement_id, agreement_version_id, intended_email_normalized, token_hash, expires_at, created_by_admin_id, created_at)
    VALUES (?, 'agr_preview_a', 'agrv_preview_a', 'owner+a@example.test', ?, ?, 'adm_preview_owner', ?)`)
    .run('inv_phase_d_replay', await sha256(replayToken), future, now);

  let response = await rawRequest(env, 'POST', '/api/ops/invites/exchange', { body: { agreementId: 'agr_preview_a', inviteToken: replayToken } });
  assert.equal(response.status, 200);
  response = await rawRequest(env, 'POST', '/api/ops/invites/exchange', { body: { agreementId: 'agr_preview_a', inviteToken: replayToken } });
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, 'invalid_invite');

  const mismatchToken = 'phase-d-mismatch-token';
  database.prepare(`INSERT INTO agreement_invites (id, agreement_id, agreement_version_id, intended_email_normalized, token_hash, expires_at, created_by_admin_id, created_at)
    VALUES (?, 'agr_preview_a', 'agrv_preview_a', 'owner+a@example.test', ?, ?, 'adm_preview_owner', ?)`)
    .run('inv_phase_d_mismatch', await sha256(mismatchToken), future, now);

  // Forged/mismatched agreement ID paired with a real token for a *different* agreement must fail closed.
  response = await rawRequest(env, 'POST', '/api/ops/invites/exchange', { body: { agreementId: 'agr_preview_b', inviteToken: mismatchToken } });
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, 'invalid_invite');

  // The real invite must remain unconsumed after the mismatched attempt.
  response = await rawRequest(env, 'POST', '/api/ops/invites/exchange', { body: { agreementId: 'agr_preview_a', inviteToken: mismatchToken } });
  assert.equal(response.status, 200);
  database.close();
});

test('Direct API access without a valid session is rejected with 401 across representative protected routes', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const getRoutes = ['/api/ops/portal', '/api/ops/admin/summary', '/api/ops/agreements/current', '/api/ops/enrollment/status', '/api/ops/session'];
  for (const path of getRoutes) {
    const response = await rawRequest(env, 'GET', path, {});
    assert.equal(response.status, 401, `${path} should require a session`);
    assert.equal((await response.json()).error.code, 'authentication_required');
  }
  const postRoutes = ['/api/ops/billing/portal', '/api/ops/checkout', '/api/ops/agreements/accept', '/api/ops/admin/clients-projects', '/api/ops/session/logout'];
  for (const path of postRoutes) {
    const response = await rawRequest(env, 'POST', path, { body: {} });
    assert.equal(response.status, 401, `${path} should require a session`);
    assert.equal((await response.json()).error.code, 'authentication_required');
  }
  database.close();
});

test('Session lifecycle: an expired session is rejected and rotating a session invalidates the prior token against replay', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const now = new Date().toISOString();

  const expiredToken = 'phase-d-expired-token';
  database.prepare(`INSERT INTO access_sessions (id, token_hash, csrf_hash, actor_type, actor_id, client_id, agreement_id, role, expires_at, created_at, last_seen_at)
    VALUES (?, ?, ?, 'client_user', 'usr_preview_d', 'clt_preview_d', NULL, 'client_owner', '2000-01-01T00:00:00.000Z', ?, ?)`)
    .run('sess_phase_d_expired', await sha256(expiredToken), await sha256('unused-csrf'), now, now);
  let response = await rawRequest(env, 'GET', '/api/ops/portal', { cookie: `__Host-e4la_ops=${expiredToken}` });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, 'session_expired');

  const viewer = await createSession(env.ENROLLMENT_DB, {
    actorType: 'client_user', actorId: 'usr_preview_d', clientId: 'clt_preview_d', role: 'client_viewer', ttlSeconds: 3600,
  });
  response = await operationsRequest(env, 'GET', '/api/ops/portal', viewer);
  assert.equal(response.status, 200);

  response = await operationsRequest(env, 'GET', '/api/ops/session', viewer);
  assert.equal(response.status, 200);
  const rotatedCookie = extractSessionCookie(response);
  assert.notEqual(rotatedCookie, `__Host-e4la_ops=${encodeURIComponent(viewer.token)}`);

  response = await rawRequest(env, 'GET', '/api/ops/portal', { cookie: `__Host-e4la_ops=${encodeURIComponent(viewer.token)}` });
  assert.equal(response.status, 401, 'the pre-rotation token must not be usable again');
  assert.equal((await response.json()).error.code, 'session_expired');

  response = await rawRequest(env, 'GET', '/api/ops/portal', { cookie: rotatedCookie });
  assert.equal(response.status, 200, 'the rotated token must be usable');
  database.close();
});

test('CSRF and Origin enforcement guard client- and admin-scoped mutating routes, including logout', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);

  // Origin enforcement happens before authentication, so no cookie is required to prove it fails closed.
  let response = await new Promise((resolve) => resolve(handleOperationsRequest({
    request: new Request('https://e4la-client-operations-preview.pages.dev/api/ops/checkout', {
      method: 'POST', headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' }, body: '{}',
    }),
    env,
  })));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'origin_rejected');

  const owner = await createSession(env.ENROLLMENT_DB, {
    actorType: 'client_user', actorId: 'usr_preview_d', clientId: 'clt_preview_d', role: 'client_owner', ttlSeconds: 3600,
  });
  response = await operationsRequest(env, 'POST', '/api/ops/billing/portal', owner, {}, 'forged-csrf-value');
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'csrf_rejected');

  // A logout attempt with the wrong CSRF token must fail and must NOT revoke the session.
  response = await operationsRequest(env, 'POST', '/api/ops/session/logout', owner, {}, 'forged-csrf-value');
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'csrf_rejected');
  response = await operationsRequest(env, 'GET', '/api/ops/portal', owner);
  assert.equal(response.status, 200, 'the session must remain active after a rejected logout attempt');
  database.close();
});

test('Publication boundary and Admin Preview isolation: only published items are ever returned, and preview is admin/collaborator-only', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const expectedPublished = {
    updates: ['upd_d_published'], deliverables: ['del_d_pub'], milestones: ['mil_d_1', 'mil_d_2'],
  };

  const owner = await createSession(env.ENROLLMENT_DB, {
    actorType: 'client_user', actorId: 'usr_preview_d', clientId: 'clt_preview_d', role: 'client_owner', ttlSeconds: 3600,
  });
  let response = await operationsRequest(env, 'GET', '/api/ops/portal', owner);
  assert.equal(response.status, 200);
  let portal = await response.json();
  assert.deepEqual(portal.updates.map((u) => u.id).sort(), expectedPublished.updates);
  assert.deepEqual(portal.deliverables.map((d) => d.id).sort(), expectedPublished.deliverables);
  assert.deepEqual(portal.milestones.map((m) => m.id).sort(), expectedPublished.milestones);

  const admin = await createSession(env.ENROLLMENT_DB, {
    actorType: 'admin_user', actorId: 'adm_preview_owner', role: 'e4la_admin', ttlSeconds: 3600,
  });
  response = await operationsRequest(env, 'GET', '/api/ops/admin/preview/clt_preview_d', admin);
  assert.equal(response.status, 200);
  const preview = await response.json();
  assert.equal(preview.adminPreview, true);
  assert.equal(preview.label, 'ADMIN PREVIEW');
  assert.deepEqual(preview.portal.updates.map((u) => u.id).sort(), expectedPublished.updates);
  assert.deepEqual(preview.portal.deliverables.map((d) => d.id).sort(), expectedPublished.deliverables);

  // A client-role session must never be able to use the admin preview surface, own client or not.
  response = await operationsRequest(env, 'GET', '/api/ops/admin/preview/clt_preview_d', owner);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'not_authorized');

  // A forged/nonexistent client id must fail closed for admins too, not leak existence details.
  response = await operationsRequest(env, 'GET', '/api/ops/admin/preview/clt_forged_nonexistent', admin);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, 'client_not_found');
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

// rawRequest builds requests without a pre-issued session helper, for pre-authentication
// (invite exchange, 401-without-cookie, Origin-rejection) scenarios.
function rawRequest(env, method, path, { body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) {
    headers.Origin = 'https://e4la-client-operations-preview.pages.dev';
    headers['Content-Type'] = 'application/json';
  }
  if (cookie) headers.Cookie = cookie.startsWith('__Host-') ? cookie : `__Host-e4la_ops=${encodeURIComponent(cookie)}`;
  const request = new Request(`https://e4la-client-operations-preview.pages.dev${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return handleOperationsRequest({ request, env });
}

function extractSessionCookie(response) {
  const setCookie = response.headers.get('set-cookie') || '';
  const match = setCookie.match(/^(__Host-e4la_ops=[^;]+)/);
  if (!match) throw new Error('Expected a session cookie in the response.');
  return match[1];
}
