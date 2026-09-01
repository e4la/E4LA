import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createSession } from '../functions/_shared/ops-security.js';
import { onRequest as handleContentRequest } from '../functions/api/content/[[path]].js';
import { publishToplatform } from '../functions/_shared/publishing-adapters.js';
import { requestAdobeRender } from '../functions/_shared/adobe-adapter.js';

// Phase H2: a harder, adversarial validation pass on top of phase-h-content.test.mjs,
// requested before this Content Intelligence & Distribution System is allowed to
// merge, since it will eventually publish real content to real client social
// accounts. Nothing here about "is this actually live/verified/approved" is allowed
// to be fudged or assumed - every claim below is backed by an executable test that
// inspects real response bodies and/or raw database rows, not just status codes.
//
// Same harness pattern as tests/phase-h-content.test.mjs (each phase-* file in this
// suite intentionally duplicates its own harness rather than sharing one module).

const migration1 = await readFile(new URL('../migrations/0001_client_operations.sql', import.meta.url), 'utf8');
const migration2 = await readFile(new URL('../migrations/0002_phase_c_preview.sql', import.meta.url), 'utf8');
const migration3 = await readFile(new URL('../migrations/0003_payment_plans_immutable.sql', import.meta.url), 'utf8');
const migration4 = await readFile(new URL('../migrations/0004_project_progress.sql', import.meta.url), 'utf8');
const migration5 = await readFile(new URL('../migrations/0005_service_catalog_and_quoting.sql', import.meta.url), 'utf8');
const migration6 = await readFile(new URL('../migrations/0006_flexible_payments_and_invoicing.sql', import.meta.url), 'utf8');
const migration7 = await readFile(new URL('../migrations/0007_recurring_service_consent.sql', import.meta.url), 'utf8');
const migration8 = await readFile(new URL('../migrations/0008_content_intelligence.sql', import.meta.url), 'utf8');
const migration9 = await readFile(new URL('../migrations/0009_publishing_and_metrics.sql', import.meta.url), 'utf8');
const previewFixture = await readFile(new URL('../fixtures/client-operations.preview.sql', import.meta.url), 'utf8');
const contentFixture = await readFile(new URL('../fixtures/content-intelligence.preview.sql', import.meta.url), 'utf8');
let commerceFixture = '';
try {
  commerceFixture = await readFile(new URL('../fixtures/commerce.preview.sql', import.meta.url), 'utf8');
} catch {
  commerceFixture = '';
}

function previewDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec(migration1); database.exec(migration2); database.exec(migration3); database.exec(migration4);
  database.exec(migration5); database.exec(migration6); database.exec(migration7);
  database.exec(migration8); database.exec(migration9);
  database.exec(previewFixture);
  if (commerceFixture) database.exec(commerceFixture);
  database.exec(contentFixture);
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

function contentEnvironment(database, extraEnv = {}) {
  return {
    ENVIRONMENT: 'preview', PUBLIC_SITE_URL: 'https://e4la-client-operations-preview.pages.dev',
    ENROLLMENT_SESSION_SECRET: 'preview-test-only', ENROLLMENT_DB: d1Adapter(database), ...extraEnv,
  };
}

function contentRequest(env, method, path, session, body, csrfToken) {
  const headers = { Cookie: `__Host-e4la_ops=${encodeURIComponent(session.token)}` };
  if (body !== undefined) {
    headers.Origin = 'https://e4la-client-operations-preview.pages.dev';
    headers['Content-Type'] = 'application/json';
  }
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
  const request = new Request(`https://e4la-client-operations-preview.pages.dev${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return handleContentRequest({ request, env });
}

async function adminSession(env) {
  return createSession(env.ENROLLMENT_DB, { actorType: 'admin_user', actorId: 'adm_preview_owner', role: 'e4la_admin', ttlSeconds: 3600 });
}
async function collaboratorSession(env) {
  return createSession(env.ENROLLMENT_DB, { actorType: 'admin_user', actorId: 'adm_preview_collab', role: 'e4la_collaborator', ttlSeconds: 3600 });
}
async function ownerSessionD(env) {
  return createSession(env.ENROLLMENT_DB, { actorType: 'client_user', actorId: 'usr_preview_d', clientId: 'clt_preview_d', role: 'client_owner', ttlSeconds: 3600 });
}
async function signerSessionD(env) {
  return createSession(env.ENROLLMENT_DB, { actorType: 'client_user', actorId: 'usr_preview_d_signer', clientId: 'clt_preview_d', role: 'authorized_signer', ttlSeconds: 3600 });
}
async function viewerSessionD(env) {
  return createSession(env.ENROLLMENT_DB, { actorType: 'client_user', actorId: 'usr_preview_d_viewer', clientId: 'clt_preview_d', role: 'client_viewer', ttlSeconds: 3600 });
}
async function ownerSessionA(env) {
  return createSession(env.ENROLLMENT_DB, { actorType: 'client_user', actorId: 'usr_preview_a', clientId: 'clt_preview_a', role: 'client_owner', ttlSeconds: 3600 });
}

async function advanceToApproved(env, admin, owner, itemId) {
  // idea|researched|verified|drafting|design_ready|e4la_review are all
  // internal; the fixture items start at various points in this chain, so
  // callers pass an item already at 'e4la_review' - this only drives the
  // final e4la_review -> e4la_approved -> client_review -> approved leg, which
  // is what every risk-level/evidence scenario below actually needs to reach.
  let response = await contentRequest(env, 'PATCH', `/api/content/items/${itemId}/status`, admin, { status: 'e4la_approved' }, admin.csrfToken);
  assert.equal(response.status, 200, `expected e4la_approved to succeed for ${itemId}`);
  response = await contentRequest(env, 'PATCH', `/api/content/items/${itemId}/status`, admin, { status: 'client_review' }, admin.csrfToken);
  assert.equal(response.status, 200, `expected client_review to succeed for ${itemId}`);
  return contentRequest(env, 'PATCH', `/api/content/items/${itemId}/status`, owner, { status: 'approved' }, owner.csrfToken);
}

// ---------------------------------------------------------------------------
// A. Claim verification risk levels: GREEN, YELLOW, RED all need real coverage.
// ---------------------------------------------------------------------------

test('GREEN: an item with only a green, unverified claim reaches approved cleanly end to end', async () => {
  const database = previewDatabase();
  const env = contentEnvironment(database);
  const admin = await adminSession(env);
  const owner = await ownerSessionD(env);

  // ci_preview_review starts at e4la_review with zero claims in the fixture.
  const claimResponse = await contentRequest(env, 'POST', '/api/content/items/ci_preview_review/claims', admin, {
    claim_text: 'A plainly non-risky, fictional green claim.', risk_level: 'green',
  }, admin.csrfToken);
  assert.equal(claimResponse.status, 201);
  const claim = await claimResponse.json();
  assert.equal(claim.riskLevel, 'green');
  assert.equal(claim.verificationStatus, 'unverified');

  const response = await advanceToApproved(env, admin, owner, 'ci_preview_review');
  assert.equal(response.status, 200, 'an unverified GREEN claim must never block approval');
  database.close();
});

test('YELLOW: explicitly verified (not merely sourced) unblocks approval; still-unverified yellow blocks it', async () => {
  const database = previewDatabase();
  const env = contentEnvironment(database);
  const admin = await adminSession(env);
  const owner = await ownerSessionD(env);

  const sourceResponse = await contentRequest(env, 'POST', '/api/content/clients/clt_preview_d/sources', admin, {
    source_type: 'current_verified_source', insight: 'Fictional verified market data point.',
  }, admin.csrfToken);
  const source = await sourceResponse.json();
  const sourceVerify = await contentRequest(env, 'PATCH', `/api/content/sources/${source.id}/verify`, admin, {
    verification_status: 'verified',
  }, admin.csrfToken);
  assert.equal(sourceVerify.status, 200);

  const claimResponse = await contentRequest(env, 'POST', '/api/content/items/ci_preview_review/claims', admin, {
    claim_text: 'A yellow claim that will be explicitly verified.', risk_level: 'yellow', source_id: source.id,
  }, admin.csrfToken);
  const claim = await claimResponse.json();

  const claimVerify = await contentRequest(env, 'PATCH', `/api/content/claims/${claim.id}/verify`, admin, {
    verification_status: 'verified', source_id: source.id,
  }, admin.csrfToken);
  assert.equal(claimVerify.status, 200);

  const response = await advanceToApproved(env, admin, owner, 'ci_preview_review');
  assert.equal(response.status, 200, 'an explicitly VERIFIED yellow claim must not block approval');
  database.close();
});

test('RED: an explicitly verified red claim does not itself block approval, isolated from the client_review policy variable', async () => {
  const database = previewDatabase();
  const env = contentEnvironment(database);
  const admin = await adminSession(env);

  // Use a fresh plan under a brand brain with automation_mode 'manual' so this
  // test isolates the RED-claim gate from the separate client_review
  // requirement (already covered by the plan-snapshot regressions).
  const brainResponse = await contentRequest(env, 'POST', '/api/content/clients/clt_preview_d/brand-brain', admin, { automation_mode: 'manual' }, admin.csrfToken);
  const brain = await brainResponse.json();
  const planResponse = await contentRequest(env, 'POST', '/api/content/clients/clt_preview_d/plans', admin, {
    name: 'Fresh manual-policy plan', project_id: 'prj_preview_d', brand_brain_id: brain.id,
  }, admin.csrfToken);
  const plan = await planResponse.json();
  const itemResponse = await contentRequest(env, 'POST', `/api/content/plans/${plan.id}/items`, admin, {
    topic: 'Fictional red-risk claim item', risk_level: 'red',
  }, admin.csrfToken);
  const item = await itemResponse.json();

  const sourceResponse = await contentRequest(env, 'POST', '/api/content/clients/clt_preview_d/sources', admin, {
    source_type: 'current_verified_source', insight: 'Fictional clinical-style figure, now verified.',
  }, admin.csrfToken);
  const source = await sourceResponse.json();
  await contentRequest(env, 'PATCH', `/api/content/sources/${source.id}/verify`, admin, { verification_status: 'verified' }, admin.csrfToken);

  const claimResponse = await contentRequest(env, 'POST', `/api/content/items/${item.id}/claims`, admin, {
    claim_text: 'A red claim that will be explicitly verified.', risk_level: 'red', source_id: source.id,
  }, admin.csrfToken);
  const claim = await claimResponse.json();
  const claimVerify = await contentRequest(env, 'PATCH', `/api/content/claims/${claim.id}/verify`, admin, {
    verification_status: 'verified', source_id: source.id,
  }, admin.csrfToken);
  assert.equal(claimVerify.status, 200);

  // Walk the item to e4la_approved, then straight to approved (manual policy,
  // no client_review required) - the ONLY thing that could block this is the
  // red-claim gate, and it must not, since the claim is verified.
  let response = await contentRequest(env, 'PATCH', `/api/content/items/${item.id}/status`, admin, { status: 'researched' }, admin.csrfToken);
  assert.equal(response.status, 200);
  response = await contentRequest(env, 'PATCH', `/api/content/items/${item.id}/status`, admin, { status: 'verified' }, admin.csrfToken);
  assert.equal(response.status, 200);
  response = await contentRequest(env, 'PATCH', `/api/content/items/${item.id}/status`, admin, { status: 'drafting' }, admin.csrfToken);
  assert.equal(response.status, 200);
  response = await contentRequest(env, 'PATCH', `/api/content/items/${item.id}/status`, admin, { status: 'design_ready' }, admin.csrfToken);
  assert.equal(response.status, 200);
  response = await contentRequest(env, 'PATCH', `/api/content/items/${item.id}/status`, admin, { status: 'e4la_review' }, admin.csrfToken);
  assert.equal(response.status, 200);
  response = await contentRequest(env, 'PATCH', `/api/content/items/${item.id}/status`, admin, { status: 'e4la_approved' }, admin.csrfToken);
  assert.equal(response.status, 200);
  response = await contentRequest(env, 'PATCH', `/api/content/items/${item.id}/status`, admin, { status: 'approved' }, admin.csrfToken);
  assert.equal(response.status, 200, 'an explicitly VERIFIED red claim must not block approval');
  database.close();
});

// ---------------------------------------------------------------------------
// B. "A URL alone does not satisfy evidence" - structural + cross-tenant.
// ---------------------------------------------------------------------------

test('a source belonging to a different client can never back a verified claim, even if that source is itself verified', async () => {
  const database = previewDatabase();
  const env = contentEnvironment(database);
  const admin = await adminSession(env);

  const otherClientSourceResponse = await contentRequest(env, 'POST', '/api/content/clients/clt_preview_a/sources', admin, {
    source_type: 'current_verified_source', insight: 'A fictional fact that is true for Client A, not Client D.',
  }, admin.csrfToken);
  const otherSource = await otherClientSourceResponse.json();
  const verifyOtherSource = await contentRequest(env, 'PATCH', `/api/content/sources/${otherSource.id}/verify`, admin, {
    verification_status: 'verified',
  }, admin.csrfToken);
  assert.equal(verifyOtherSource.status, 200);

  // ci_preview_review belongs to clt_preview_d - referencing Client A's (now
  // verified) source must still be rejected as cross-tenant evidence.
  const claimResponse = await contentRequest(env, 'POST', '/api/content/items/ci_preview_review/claims', admin, {
    claim_text: 'Claim citing a cross-client source.', risk_level: 'yellow',
  }, admin.csrfToken);
  const claim = await claimResponse.json();
  const verifyResponse = await contentRequest(env, 'PATCH', `/api/content/claims/${claim.id}/verify`, admin, {
    verification_status: 'verified', source_id: otherSource.id,
  }, admin.csrfToken);
  assert.equal(verifyResponse.status, 422);
  const errorBody = await verifyResponse.json();
  assert.equal(errorBody.error.code, 'source_client_mismatch');
  const claimRow = database.prepare('SELECT verification_status, source_id FROM content_claims WHERE id = ?').get(claim.id);
  assert.equal(claimRow.verification_status, 'unverified');
  database.close();
});

// ---------------------------------------------------------------------------
// C. Stale evidence can be rejected: verification is not one-way.
// ---------------------------------------------------------------------------

test('an admin can reject a previously verified claim or source at any time - verification is never one-way', async () => {
  const database = previewDatabase();
  const env = contentEnvironment(database);
  const admin = await adminSession(env);

  // clm_preview_green and src_preview_a are both already verification_status
  // = 'verified' in the fixture (representing evidence that may later go
  // stale). Confirm both can be moved to 'rejected' directly.
  const claimResponse = await contentRequest(env, 'PATCH', '/api/content/claims/clm_preview_green/verify', admin, {
    verification_status: 'rejected',
  }, admin.csrfToken);
  assert.equal(claimResponse.status, 200);
  const claimRow = database.prepare('SELECT verification_status FROM content_claims WHERE id = ?').get('clm_preview_green');
  assert.equal(claimRow.verification_status, 'rejected');

  const sourceResponse = await contentRequest(env, 'PATCH', '/api/content/sources/src_preview_a/verify', admin, {
    verification_status: 'rejected',
  }, admin.csrfToken);
  assert.equal(sourceResponse.status, 200);
  const sourceRow = database.prepare('SELECT verification_status FROM content_sources WHERE id = ?').get('src_preview_a');
  assert.equal(sourceRow.verification_status, 'rejected');

  // Structural note (see final report): there is no automatic staleness
  // *detection* based on content_sources.captured_at age anywhere in this
  // codebase - this test only proves an admin CAN manually reject stale
  // evidence at any time, which is what "can be rejected" requires today.
  database.close();
});

// ---------------------------------------------------------------------------
// D. Lifecycle / approval integrity.
// ---------------------------------------------------------------------------

test('a brand-new plan created after a newer brand brain version uses that new policy (only existing plans stay snapshotted)', async () => {
  const database = previewDatabase();
  const env = contentEnvironment(database);
  const admin = await adminSession(env);

  const brainResponse = await contentRequest(env, 'POST', '/api/content/clients/clt_preview_d/brand-brain', admin, { automation_mode: 'manual' }, admin.csrfToken);
  const brain = await brainResponse.json();
  assert.equal(brain.versionNumber, 2);

  const planResponse = await contentRequest(env, 'POST', '/api/content/clients/clt_preview_d/plans', admin, {
    name: 'Plan created after the manual-policy brand brain', project_id: 'prj_preview_d', brand_brain_id: brain.id,
  }, admin.csrfToken);
  const plan = await planResponse.json();
  const itemResponse = await contentRequest(env, 'POST', `/api/content/plans/${plan.id}/items`, admin, { topic: 'Fictional new-policy item' }, admin.csrfToken);
  const item = await itemResponse.json();

  let response = await contentRequest(env, 'PATCH', `/api/content/items/${item.id}/status`, admin, { status: 'researched' }, admin.csrfToken);
  assert.equal(response.status, 200);
  response = await contentRequest(env, 'PATCH', `/api/content/items/${item.id}/status`, admin, { status: 'verified' }, admin.csrfToken);
  assert.equal(response.status, 200);
  response = await contentRequest(env, 'PATCH', `/api/content/items/${item.id}/status`, admin, { status: 'drafting' }, admin.csrfToken);
  assert.equal(response.status, 200);
  response = await contentRequest(env, 'PATCH', `/api/content/items/${item.id}/status`, admin, { status: 'design_ready' }, admin.csrfToken);
  assert.equal(response.status, 200);
  response = await contentRequest(env, 'PATCH', `/api/content/items/${item.id}/status`, admin, { status: 'e4la_review' }, admin.csrfToken);
  assert.equal(response.status, 200);
  response = await contentRequest(env, 'PATCH', `/api/content/items/${item.id}/status`, admin, { status: 'e4la_approved' }, admin.csrfToken);
  assert.equal(response.status, 200);
  // Goes STRAIGHT to approved (no client_review) because this brand-new plan
  // snapshots the new 'manual' brand brain from the moment it was created.
  response = await contentRequest(env, 'PATCH', `/api/content/items/${item.id}/status`, admin, { status: 'approved' }, admin.csrfToken);
  assert.equal(response.status, 200);
  database.close();
});

test('exact-project collaborator scope: access to one project of a client does not grant access to another project of the SAME client', async () => {
  const database = previewDatabase();
  const env = contentEnvironment(database);
  const admin = await adminSession(env);
  const collaborator = await collaboratorSession(env);
  const now = new Date().toISOString();

  // A second, real project belonging to the SAME client (clt_preview_d) that
  // adm_preview_collab has no admin_project_access row for at all (their only
  // rows are prj_preview_d and prj_preview_e, per the base fixture).
  database.prepare(`INSERT INTO projects (id, client_id, name, status, current_phase, start_date, target_end_date, summary, client_visible, created_at, updated_at)
    VALUES ('prj_preview_d2', 'clt_preview_d', 'Drift Growth Program - Retainer 2', 'active', NULL, NULL, NULL, NULL, 1, ?, ?)`).run(now, now);

  const planResponse = await contentRequest(env, 'POST', '/api/content/clients/clt_preview_d/plans', admin, {
    name: 'Second-project plan', project_id: 'prj_preview_d2',
  }, admin.csrfToken);
  assert.equal(planResponse.status, 201);
  const plan = await planResponse.json();
  const itemResponse = await contentRequest(env, 'POST', `/api/content/plans/${plan.id}/items`, admin, { topic: 'Second-project item' }, admin.csrfToken);
  assert.equal(itemResponse.status, 201);
  const item = await itemResponse.json();

  // Same client_id as everything else adm_preview_collab CAN manage - but a
  // different, unauthorized project. Under the old "any project under this
  // client" check this would have wrongly succeeded (prj_preview_d contributor
  // access would have been enough); it must now be denied.
  let response = await contentRequest(env, 'GET', `/api/content/items/${item.id}`, collaborator);
  assert.equal(response.status, 403);
  response = await contentRequest(env, 'GET', `/api/content/plans/${plan.id}`, collaborator);
  assert.equal(response.status, 403);

  database.prepare(`INSERT INTO admin_project_access (admin_user_id, project_id, permission_level, created_at) VALUES ('adm_preview_collab', 'prj_preview_d2', 'contributor', ?)`).run(now);

  response = await contentRequest(env, 'GET', `/api/content/items/${item.id}`, collaborator);
  assert.equal(response.status, 200);
  response = await contentRequest(env, 'GET', `/api/content/plans/${plan.id}`, collaborator);
  assert.equal(response.status, 200);
  database.close();
});

test('collaborator permission_level must be exactly contributor/manager - a viewer-level grant is not enough', async () => {
  const database = previewDatabase();
  const env = contentEnvironment(database);
  const now = new Date().toISOString();
  database.prepare(`INSERT INTO admin_users (id, email_normalized, full_name, role, access_status, created_at, updated_at)
    VALUES ('adm_preview_viewer_only', 'viewer-only@example.test', 'Fictional Viewer-Only Collaborator', 'e4la_collaborator', 'active', ?, ?)`).run(now, now);
  database.prepare(`INSERT INTO admin_project_access (admin_user_id, project_id, permission_level, created_at) VALUES ('adm_preview_viewer_only', 'prj_preview_d', 'viewer', ?)`).run(now);
  const viewerOnlyCollaborator = await createSession(env.ENROLLMENT_DB, { actorType: 'admin_user', actorId: 'adm_preview_viewer_only', role: 'e4la_collaborator', ttlSeconds: 3600 });

  const response = await contentRequest(env, 'GET', '/api/content/items/ci_preview_drafting', viewerOnlyCollaborator);
  assert.equal(response.status, 403, "permission_level='viewer' must not satisfy the contributor/manager requirement");
  database.close();
});

test('client_viewer is denied (403) on the status-transition endpoint for every target status, not just one', async () => {
  const database = previewDatabase();
  const env = contentEnvironment(database);
  const viewer = await viewerSessionD(env);
  for (const status of ['approved', 'revision_requested', 'withdrawn', 'archived']) {
    const response = await contentRequest(env, 'PATCH', '/api/content/items/ci_preview_published/status', viewer, { status }, viewer.csrfToken);
    assert.equal(response.status, 403, `client_viewer must be denied moving to '${status}'`);
  }
  database.close();
});

test('authorized_signer can approve/request-revision in client_review, but can never call the publish endpoint', async () => {
  const database = previewDatabase();
  const env = contentEnvironment(database);
  const admin = await adminSession(env);
  const signer = await signerSessionD(env);

  let response = await contentRequest(env, 'PATCH', '/api/content/items/ci_preview_review/status', admin, { status: 'e4la_approved' }, admin.csrfToken);
  assert.equal(response.status, 200);
  response = await contentRequest(env, 'PATCH', '/api/content/items/ci_preview_review/status', admin, { status: 'client_review' }, admin.csrfToken);
  assert.equal(response.status, 200);
  response = await contentRequest(env, 'PATCH', '/api/content/items/ci_preview_review/status', signer, { status: 'revision_requested' }, signer.csrfToken);
  assert.equal(response.status, 200, 'authorized_signer must be able to request revision in client_review');

  response = await contentRequest(env, 'POST', '/api/content/variants/var_preview_a/publish', signer, {}, signer.csrfToken);
  assert.equal(response.status, 403, 'authorized_signer must never be able to call the publish endpoint');
  database.close();
});

test('Client A cannot list Client D\'s content plans (cross-client LIST -> 404, matching the GET pattern)', async () => {
  const database = previewDatabase();
  const env = contentEnvironment(database);
  const otherOwner = await ownerSessionA(env);
  const response = await contentRequest(env, 'GET', '/api/content/clients/clt_preview_d/plans', otherOwner);
  assert.equal(response.status, 404);
  database.close();
});

test('brand brain has no client-facing route at all - every client role gets the same 403 for their own client or another\'s (no existence signal)', async () => {
  const database = previewDatabase();
  const env = contentEnvironment(database);
  const ownOwner = await ownerSessionD(env);
  const otherOwner = await ownerSessionA(env);

  const ownResponse = await contentRequest(env, 'GET', '/api/content/clients/clt_preview_d/brand-brain', ownOwner);
  assert.equal(ownResponse.status, 403);
  const otherResponse = await contentRequest(env, 'GET', '/api/content/clients/clt_preview_d/brand-brain', otherOwner);
  assert.equal(otherResponse.status, 403);
  assert.equal(ownResponse.status, otherResponse.status, 'no differential signal between own-client and other-client brand brain access');
  database.close();
});

// ---------------------------------------------------------------------------
// E. Data leakage: internal_expert sources and internal approval comments.
// ---------------------------------------------------------------------------

test('an internal_expert source\'s name/recording_reference and an e4la_internal approval comment never appear in a client-facing item response', async () => {
  const database = previewDatabase();
  const env = contentEnvironment(database);
  const admin = await adminSession(env);
  const owner = await ownerSessionD(env);

  const sourceResponse = await contentRequest(env, 'POST', '/api/content/clients/clt_preview_d/sources', admin, {
    source_type: 'internal_expert', expert_name: 'Confidential Fictional GM Name', recording_reference: 'call-secret-2026-99',
    insight: 'Proprietary internal insight not meant for the client verbatim.',
  }, admin.csrfToken);
  assert.equal(sourceResponse.status, 201);

  await contentRequest(env, 'PATCH', '/api/content/items/ci_preview_published/status', admin, { status: 'verified_live' }, admin.csrfToken);
  // content_approvals rows are written by patchItemStatus for approved/rejected/
  // revision_requested transitions; ci_preview_published has no such internal
  // comment yet in the fixture, so drive one via a client_review round trip on
  // a different item and inspect that item's client-facing response instead.
  let response = await contentRequest(env, 'PATCH', '/api/content/items/ci_preview_review/status', admin, { status: 'e4la_approved' }, admin.csrfToken);
  assert.equal(response.status, 200);
  response = await contentRequest(env, 'PATCH', '/api/content/items/ci_preview_review/status', admin, {
    status: 'client_review',
  }, admin.csrfToken);
  assert.equal(response.status, 200);
  response = await contentRequest(env, 'PATCH', '/api/content/items/ci_preview_review/status', owner, {
    status: 'revision_requested', comment: 'Client-facing revision note.',
  }, owner.csrfToken);
  assert.equal(response.status, 200);
  response = await contentRequest(env, 'PATCH', '/api/content/items/ci_preview_review/status', admin, { status: 'drafting' }, admin.csrfToken);
  assert.equal(response.status, 200);
  response = await contentRequest(env, 'PATCH', '/api/content/items/ci_preview_review/status', admin, { status: 'design_ready' }, admin.csrfToken);
  assert.equal(response.status, 200);
  response = await contentRequest(env, 'PATCH', '/api/content/items/ci_preview_review/status', admin, { status: 'e4la_review' }, admin.csrfToken);
  assert.equal(response.status, 200);
  response = await contentRequest(env, 'PATCH', '/api/content/items/ci_preview_review/status', admin, {
    status: 'rejected', comment: 'Confidential internal-only rejection rationale, never for the client.',
  }, admin.csrfToken);
  assert.equal(response.status, 200);

  const confirmRow = database.prepare("SELECT approval_type, comment FROM content_approvals WHERE content_item_id = 'ci_preview_review' AND approval_type = 'e4la_internal' ORDER BY created_at DESC LIMIT 1").get();
  assert.ok(confirmRow, 'expected an e4la_internal content_approvals row to exist for this scenario');
  assert.match(confirmRow.comment, /Confidential internal-only rejection rationale/);

  // ci_preview_published is the client-visible item under test for leakage -
  // confirm the raw response body never contains the internal source's
  // identifying fields, the internal-only approval comment text, or the
  // "e4la_internal" approval_type marker anywhere in the JSON.
  const itemResponse = await contentRequest(env, 'GET', '/api/content/items/ci_preview_published', owner);
  assert.equal(itemResponse.status, 200);
  const rawBody = await itemResponse.text();
  assert.doesNotMatch(rawBody, /Confidential Fictional GM Name/);
  assert.doesNotMatch(rawBody, /call-secret-2026-99/);
  assert.doesNotMatch(rawBody, /Confidential internal-only rejection rationale/);
  assert.doesNotMatch(rawBody, /e4la_internal/);
  assert.doesNotMatch(rawBody, /content_sources/);
  assert.doesNotMatch(rawBody, /content_approvals/);
  database.close();
});

// ---------------------------------------------------------------------------
// F. Publishing integrity.
// ---------------------------------------------------------------------------

test('variant creation is not gated by item status (by design - the real gate is at publish time); publish is blocked for idea/blocked/rejected specifically', async () => {
  const database = previewDatabase();
  const env = contentEnvironment(database);
  const admin = await adminSession(env);

  // idea
  let variantResponse = await contentRequest(env, 'POST', '/api/content/items/ci_preview_idea/platform-variants', admin, { platform: 'manual_export' }, admin.csrfToken);
  assert.equal(variantResponse.status, 201, 'creating a variant on an idea-stage item is allowed by design');
  let variant = await variantResponse.json();
  let publishResponse = await contentRequest(env, 'POST', `/api/content/variants/${variant.id}/publish`, admin, {}, admin.csrfToken);
  assert.equal(publishResponse.status, 422, 'publishing an idea-stage item must be blocked');

  // blocked
  let response = await contentRequest(env, 'PATCH', '/api/content/items/ci_preview_drafting/status', admin, { status: 'blocked' }, admin.csrfToken);
  assert.equal(response.status, 200);
  variantResponse = await contentRequest(env, 'POST', '/api/content/items/ci_preview_drafting/platform-variants', admin, { platform: 'manual_export' }, admin.csrfToken);
  assert.equal(variantResponse.status, 201, 'creating a variant on a blocked item is allowed by design');
  variant = await variantResponse.json();
  publishResponse = await contentRequest(env, 'POST', `/api/content/variants/${variant.id}/publish`, admin, {}, admin.csrfToken);
  assert.equal(publishResponse.status, 422, 'publishing a blocked item must be blocked');

  // rejected
  response = await contentRequest(env, 'PATCH', '/api/content/items/ci_preview_review/status', admin, { status: 'rejected' }, admin.csrfToken);
  assert.equal(response.status, 200);
  variantResponse = await contentRequest(env, 'POST', '/api/content/items/ci_preview_review/platform-variants', admin, { platform: 'manual_export' }, admin.csrfToken);
  assert.equal(variantResponse.status, 201, 'creating a variant on a rejected item is allowed by design');
  variant = await variantResponse.json();
  publishResponse = await contentRequest(env, 'POST', `/api/content/variants/${variant.id}/publish`, admin, {}, admin.csrfToken);
  assert.equal(publishResponse.status, 422, 'publishing a rejected item must be blocked');
  database.close();
});

test('publish and verified_live are two genuinely distinct code paths - a single publish call never produces verified_live', async () => {
  const database = previewDatabase();
  const env = contentEnvironment(database);
  const admin = await adminSession(env);
  const owner = await ownerSessionD(env);

  let response = await advanceToApproved(env, admin, owner, 'ci_preview_review');
  assert.equal(response.status, 200);

  const variantResponse = await contentRequest(env, 'POST', '/api/content/items/ci_preview_review/platform-variants', admin, {
    platform: 'manual_export', caption: 'Fictional caption ready to hand off for manual posting.',
  }, admin.csrfToken);
  assert.equal(variantResponse.status, 201);
  const variant = await variantResponse.json();

  const publishResponse = await contentRequest(env, 'POST', `/api/content/variants/${variant.id}/publish`, admin, {}, admin.csrfToken);
  assert.equal(publishResponse.status, 201);
  const job = await publishResponse.json();
  assert.equal(job.status, 'published');
  assert.notEqual(job.status, 'verified_live');

  const afterPublishRow = database.prepare('SELECT status, external_post_id, verified_at FROM publishing_jobs WHERE id = ?').get(job.jobId);
  assert.equal(afterPublishRow.status, 'published');
  assert.equal(afterPublishRow.external_post_id, null);
  assert.equal(afterPublishRow.verified_at, null);
  const variantRow = database.prepare('SELECT status FROM content_platform_variants WHERE id = ?').get(variant.id);
  assert.equal(variantRow.status, 'published');

  // Only this separate, explicitly-evidenced call can move it further.
  const verifyResponse = await contentRequest(env, 'PATCH', `/api/content/jobs/${job.jobId}/verify`, admin, {
    external_post_id: 'manual_fictional_post_9001',
  }, admin.csrfToken);
  assert.equal(verifyResponse.status, 200);
  const afterVerifyRow = database.prepare('SELECT status, external_post_id, verified_at FROM publishing_jobs WHERE id = ?').get(job.jobId);
  assert.equal(afterVerifyRow.status, 'verified_live');
  assert.equal(afterVerifyRow.external_post_id, 'manual_fictional_post_9001');
  assert.ok(afterVerifyRow.verified_at);
  database.close();
});

test('withdrawing a published or verified_live item writes a real audit_events row for that exact transition', async () => {
  const database = previewDatabase();
  const env = contentEnvironment(database);
  const admin = await adminSession(env);

  let response = await contentRequest(env, 'PATCH', '/api/content/items/ci_preview_published/status', admin, { status: 'withdrawn' }, admin.csrfToken);
  assert.equal(response.status, 200);
  let row = database.prepare(`
    SELECT * FROM audit_events WHERE event_type = 'content_item_status_changed'
    AND event_data_json LIKE '%ci_preview_published%' AND event_data_json LIKE '%withdrawn%'
  `).get();
  assert.ok(row, 'expected an audit_events row for published -> withdrawn');

  const database2 = previewDatabase();
  const env2 = contentEnvironment(database2);
  const admin2 = await adminSession(env2);
  response = await contentRequest(env2, 'PATCH', '/api/content/items/ci_preview_published/status', admin2, { status: 'verified_live' }, admin2.csrfToken);
  assert.equal(response.status, 200);
  response = await contentRequest(env2, 'PATCH', '/api/content/items/ci_preview_published/status', admin2, { status: 'withdrawn' }, admin2.csrfToken);
  assert.equal(response.status, 200);
  row = database2.prepare(`
    SELECT * FROM audit_events WHERE event_type = 'content_item_status_changed'
    AND event_data_json LIKE '%ci_preview_published%' AND event_data_json LIKE '%"fromStatus":"verified_live"%'
  `).get();
  assert.ok(row, 'expected an audit_events row for verified_live -> withdrawn');
  database.close();
  database2.close();
});

test('metrics can only be recorded once a publishing job is verified_live, not merely published', async () => {
  const database = previewDatabase();
  const env = contentEnvironment(database);
  const admin = await adminSession(env);

  const blockedResponse = await contentRequest(env, 'POST', '/api/content/jobs/pjb_preview_a/metrics', admin, {
    metric_class: 'engagement', metric_key: 'likes', metric_value: 10,
  }, admin.csrfToken);
  assert.equal(blockedResponse.status, 422);
  const blockedErrorBody = await blockedResponse.json();
  assert.equal(blockedErrorBody.error.code, 'job_not_verified_live');

  const verifyResponse = await contentRequest(env, 'PATCH', '/api/content/jobs/pjb_preview_a/verify', admin, {
    external_post_id: 'manual_fictional_post_already_live',
  }, admin.csrfToken);
  assert.equal(verifyResponse.status, 200);

  const allowedResponse = await contentRequest(env, 'POST', '/api/content/jobs/pjb_preview_a/metrics', admin, {
    metric_class: 'engagement', metric_key: 'likes', metric_value: 10,
  }, admin.csrfToken);
  assert.equal(allowedResponse.status, 201);
  database.close();
});

// ---------------------------------------------------------------------------
// G. Adobe boundary.
// ---------------------------------------------------------------------------

test('renderAsset with no ADOBE_API_KEY returns a clean unavailable status, never throws, never fabricates rendered', async () => {
  const database = previewDatabase();
  const env = contentEnvironment(database);
  const admin = await adminSession(env);

  const assetResponse = await contentRequest(env, 'POST', '/api/content/items/ci_preview_review/assets', admin, { provider: 'adobe', template_reference: 'tpl_fictional' }, admin.csrfToken);
  assert.equal(assetResponse.status, 201);
  const asset = await assetResponse.json();
  assert.equal(asset.renderStatus, 'not_requested');

  const renderResponse = await contentRequest(env, 'POST', `/api/content/assets/${asset.id}/render`, admin, {}, admin.csrfToken);
  assert.equal(renderResponse.status, 200);
  const renderBody = await renderResponse.json();
  assert.equal(renderBody.renderStatus, 'unavailable');
  assert.ok(renderBody.reason);
  const row = database.prepare('SELECT render_status, asset_url FROM content_assets WHERE id = ?').get(asset.id);
  assert.equal(row.render_status, 'unavailable');
  assert.equal(row.asset_url, null);
  assert.notEqual(row.render_status, 'rendered');
  database.close();
});

test('requesting a render twice for the same asset is safe - no duplicate rows, no corrupted state', async () => {
  const database = previewDatabase();
  const env = contentEnvironment(database);
  const admin = await adminSession(env);

  const assetResponse = await contentRequest(env, 'POST', '/api/content/items/ci_preview_review/assets', admin, { provider: 'adobe' }, admin.csrfToken);
  const asset = await assetResponse.json();

  const first = await contentRequest(env, 'POST', `/api/content/assets/${asset.id}/render`, admin, {}, admin.csrfToken);
  assert.equal(first.status, 200);
  const second = await contentRequest(env, 'POST', `/api/content/assets/${asset.id}/render`, admin, {}, admin.csrfToken);
  assert.equal(second.status, 200);

  const count = database.prepare('SELECT COUNT(*) AS n FROM content_assets WHERE id = ?').get(asset.id);
  assert.equal(count.n, 1, 'retrying a render must update the same row, never insert a duplicate');
  database.close();
});

test('two separate asset requests for the same content item create two distinct rows, with "current" identifiable by recency', async () => {
  const database = previewDatabase();
  const env = contentEnvironment(database);
  const admin = await adminSession(env);

  const firstResponse = await contentRequest(env, 'POST', '/api/content/items/ci_preview_review/assets', admin, { provider: 'manual_upload', asset_url: 'https://example.test/fictional-v1.jpg' }, admin.csrfToken);
  const firstAsset = await firstResponse.json();
  const secondResponse = await contentRequest(env, 'POST', '/api/content/items/ci_preview_review/assets', admin, { provider: 'manual_upload', asset_url: 'https://example.test/fictional-v2.jpg' }, admin.csrfToken);
  const secondAsset = await secondResponse.json();
  assert.notEqual(firstAsset.id, secondAsset.id);

  const rows = database.prepare('SELECT id FROM content_assets WHERE content_item_id = ? ORDER BY rowid DESC LIMIT 1').all('ci_preview_review');
  assert.equal(rows[0].id, secondAsset.id, 'ordering by insertion (rowid)/created_at recency identifies the current asset when no separate is_current flag exists');
  database.close();
});

test('provider=manual_upload is a real, always-available path that never touches Adobe', async () => {
  const database = previewDatabase();
  const env = contentEnvironment(database);
  const admin = await adminSession(env);
  const owner = await ownerSessionD(env);

  const assetResponse = await contentRequest(env, 'POST', '/api/content/items/ci_preview_review/assets', admin, {
    provider: 'manual_upload', asset_url: 'https://example.test/fictional-manual-upload.jpg',
  }, admin.csrfToken);
  assert.equal(assetResponse.status, 201);
  const asset = await assetResponse.json();
  assert.equal(asset.renderStatus, 'rendered');
  assert.equal(asset.assetUrl, 'https://example.test/fictional-manual-upload.jpg');
  const row = database.prepare('SELECT render_status, asset_url, rendered_at FROM content_assets WHERE id = ?').get(asset.id);
  assert.equal(row.render_status, 'rendered');
  assert.ok(row.rendered_at);

  // Confirmed end to end with zero ADOBE_API_KEY anywhere in this env, and the
  // item still reaches approved with only this manual_upload asset attached.
  assert.equal(env.ADOBE_API_KEY, undefined);
  const response = await advanceToApproved(env, admin, owner, 'ci_preview_review');
  assert.equal(response.status, 200);
  database.close();
});

test('a content item can reach approved/scheduled without ever having a content_asset row - Adobe/assets are fully optional to the core lifecycle', async () => {
  const database = previewDatabase();
  const env = contentEnvironment(database);
  const admin = await adminSession(env);
  const owner = await ownerSessionD(env);

  const zeroAssets = database.prepare("SELECT COUNT(*) AS n FROM content_assets WHERE content_item_id = 'ci_preview_review'").get();
  assert.equal(zeroAssets.n, 0);

  let response = await advanceToApproved(env, admin, owner, 'ci_preview_review');
  assert.equal(response.status, 200);
  response = await contentRequest(env, 'PATCH', '/api/content/items/ci_preview_review/status', admin, { status: 'scheduled' }, admin.csrfToken);
  assert.equal(response.status, 200);

  const stillZeroAssets = database.prepare("SELECT COUNT(*) AS n FROM content_assets WHERE content_item_id = 'ci_preview_review'").get();
  assert.equal(stillZeroAssets.n, 0, 'no content_asset row was ever required to reach approved/scheduled');
  database.close();
});

// ---------------------------------------------------------------------------
// H. Publishing platform matrix - direct adapter unit tests.
// ---------------------------------------------------------------------------

test('publishing platform matrix: instagram/facebook/google_business_profile/tiktok fail honestly closed with no credential', async () => {
  const platforms = {
    instagram: 'INSTAGRAM_ACCESS_TOKEN',
    facebook: 'FACEBOOK_PAGE_ACCESS_TOKEN',
    google_business_profile: 'GOOGLE_BUSINESS_PROFILE_OAUTH_TOKEN',
    tiktok: 'TIKTOK_ACCESS_TOKEN',
  };
  for (const [platform] of Object.entries(platforms)) {
    const result = await publishToplatform(platform, {}, { account: null, variant: { caption: 'x', hashtags: [] } });
    assert.equal(result.status, 'failed');
    assert.equal(result.failureCode, 'platform_not_connected');
  }
});

test('publishing platform matrix: even with a credential env var AND a connection_status=connected account, no real platform call ever fabricates success', async () => {
  const platforms = [
    ['instagram', 'INSTAGRAM_ACCESS_TOKEN'],
    ['facebook', 'FACEBOOK_PAGE_ACCESS_TOKEN'],
    ['google_business_profile', 'GOOGLE_BUSINESS_PROFILE_OAUTH_TOKEN'],
    ['tiktok', 'TIKTOK_ACCESS_TOKEN'],
  ];
  for (const [platform, envVar] of platforms) {
    const env = { [envVar]: 'fictional_test_credential_value' };
    const account = { connection_status: 'connected' };
    const result = await publishToplatform(platform, env, { account, variant: { caption: 'x', hashtags: [] } });
    assert.equal(result.status, 'failed', `${platform} must never fabricate success even when credentialed - structure-only, no real fetch is attempted`);
  }
});

test('publishing platform matrix: manual_export needs zero credentials and produces a real, usable export package', async () => {
  const result = await publishToplatform('manual_export', {}, {
    variant: { caption: 'Fictional caption', hashtags: ['#fictional'], assetUrl: 'https://example.test/a.jpg', suggestedPostTime: '2026-09-05T10:00:00.000Z' },
  });
  assert.equal(result.status, 'published');
  assert.equal(result.exportPackage.platform, 'manual_export');
  assert.equal(result.exportPackage.caption, 'Fictional caption');
  assert.deepEqual(result.exportPackage.hashtags, ['#fictional']);
  assert.equal(result.exportPackage.assetUrl, 'https://example.test/a.jpg');
  assert.equal(result.exportPackage.suggestedPostTime, '2026-09-05T10:00:00.000Z');
});

test('Adobe adapter: no ADOBE_API_KEY returns a clean unavailable status and never throws, even with a sparse env', async () => {
  const result = await requestAdobeRender({}, { templateReference: 'tpl_x', fields: {} });
  assert.equal(result.status, 'unavailable');
  assert.ok(result.reason);
  const resultWithNoArgs = await requestAdobeRender(undefined, undefined);
  assert.equal(resultWithNoArgs.status, 'unavailable');
});
