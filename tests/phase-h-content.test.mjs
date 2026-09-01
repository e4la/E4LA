import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createSession } from '../functions/_shared/ops-security.js';
import { onRequest as handleContentRequest } from '../functions/api/content/[[path]].js';

// Phase H: Content Intelligence (brand brain, content plans/items, sources/claims,
// assets, platform variants, publishing/metrics). Exercises
// functions/api/content/[[path]].js only through its public request handler,
// exactly like tests/phase-e-progress.test.mjs does for the ops router.

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
// commerce.preview.sql belongs to the concurrent Commercial-layer agent's work
// (functions/api/commerce/**, functions/_shared/services.js etc, none of which this
// file touches). It is loaded here only because it already exists on disk and is
// additive on top of the same base fixture this suite also needs - if it is ever
// absent this loader still works with just the base + content fixtures.
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

function contentEnvironment(database) {
  return {
    ENVIRONMENT: 'preview', PUBLIC_SITE_URL: 'https://e4la-client-operations-preview.pages.dev',
    ENROLLMENT_SESSION_SECRET: 'preview-test-only', ENROLLMENT_DB: d1Adapter(database),
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
async function viewerSessionD(env) {
  return createSession(env.ENROLLMENT_DB, { actorType: 'client_user', actorId: 'usr_preview_d_viewer', clientId: 'clt_preview_d', role: 'client_viewer', ttlSeconds: 3600 });
}
async function ownerSessionA(env) {
  return createSession(env.ENROLLMENT_DB, { actorType: 'client_user', actorId: 'usr_preview_a', clientId: 'clt_preview_a', role: 'client_owner', ttlSeconds: 3600 });
}

// ---------------------------------------------------------------------------
// Cross-client isolation
// ---------------------------------------------------------------------------

test('Client A cannot read Client B content (cross-client GET on items/plans -> 404)', async () => {
  const database = previewDatabase();
  const env = contentEnvironment(database);
  const otherOwner = await ownerSessionA(env);

  let response = await contentRequest(env, 'GET', '/api/content/items/ci_preview_published', otherOwner);
  assert.equal(response.status, 404);

  response = await contentRequest(env, 'GET', '/api/content/plans/cip_preview_b', otherOwner);
  assert.equal(response.status, 404);

  response = await contentRequest(env, 'GET', '/api/content/clients/clt_preview_d/items', otherOwner);
  assert.equal(response.status, 404);
  database.close();
});

test('Client A cannot approve Client B content (cross-client status-transition attempt -> 403/404)', async () => {
  const database = previewDatabase();
  const env = contentEnvironment(database);
  const otherOwner = await ownerSessionA(env);
  const response = await contentRequest(env, 'PATCH', '/api/content/items/ci_preview_approved_e4la/status', otherOwner, { status: 'approved' }, otherOwner.csrfToken);
  assert.ok([403, 404].includes(response.status));
  database.close();
});

// ---------------------------------------------------------------------------
// Collaborator scoping
// ---------------------------------------------------------------------------

test('Collaborator scoped: 403 without admin_project_access for the item\'s project, succeeds with it', async () => {
  const database = previewDatabase();
  const env = contentEnvironment(database);
  const collaborator = await collaboratorSession(env);

  // adm_preview_collab has admin_project_access for prj_preview_d (clt_preview_d) but
  // NOT for prj_preview_a (clt_preview_a) in fixtures/client-operations.preview.sql.
  let response = await contentRequest(env, 'GET', '/api/content/clients/clt_preview_a/items', collaborator);
  assert.equal(response.status, 403);

  response = await contentRequest(env, 'GET', '/api/content/clients/clt_preview_d/items', collaborator);
  assert.equal(response.status, 200);
  database.close();
});

// ---------------------------------------------------------------------------
// Viewer read-only
// ---------------------------------------------------------------------------

test('Viewer read-only: client_viewer can GET published-appropriate content, cannot PATCH any status', async () => {
  const database = previewDatabase();
  const env = contentEnvironment(database);
  const viewer = await viewerSessionD(env);

  let response = await contentRequest(env, 'GET', '/api/content/items/ci_preview_published', viewer);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.id, 'ci_preview_published');

  // idea/drafting/e4la_review stage items must never be visible to a viewer.
  response = await contentRequest(env, 'GET', '/api/content/items/ci_preview_drafting', viewer);
  assert.equal(response.status, 404);

  response = await contentRequest(env, 'PATCH', '/api/content/items/ci_preview_published/status', viewer, { status: 'withdrawn' }, viewer.csrfToken);
  assert.equal(response.status, 403);
  database.close();
});

// ---------------------------------------------------------------------------
// Client approver cannot publish
// ---------------------------------------------------------------------------

test('Client approver cannot publish: client_owner with approval rights still cannot call publish (admin-only)', async () => {
  const database = previewDatabase();
  const env = contentEnvironment(database);
  const owner = await ownerSessionD(env);
  const response = await contentRequest(env, 'POST', '/api/content/variants/var_preview_a/publish', owner, {}, owner.csrfToken);
  assert.equal(response.status, 403);
  database.close();
});

// ---------------------------------------------------------------------------
// Publishing before approval rejected
// ---------------------------------------------------------------------------

test('Publishing before approval rejected: a variant on a not-yet-approved item -> 422', async () => {
  const database = previewDatabase();
  const env = contentEnvironment(database);
  const admin = await adminSession(env);

  const variantResponse = await contentRequest(env, 'POST', '/api/content/items/ci_preview_drafting/platform-variants', admin, {
    platform: 'manual_export', caption: 'Not yet approved',
  }, admin.csrfToken);
  assert.equal(variantResponse.status, 201);
  const variant = await variantResponse.json();

  const publishResponse = await contentRequest(env, 'POST', `/api/content/variants/${variant.id}/publish`, admin, {}, admin.csrfToken);
  assert.equal(publishResponse.status, 422);
  database.close();
});

// ---------------------------------------------------------------------------
// Rejected/blocked cannot schedule
// ---------------------------------------------------------------------------

test('Rejected/blocked cannot schedule', async () => {
  const database = previewDatabase();
  const env = contentEnvironment(database);
  const admin = await adminSession(env);

  let response = await contentRequest(env, 'PATCH', '/api/content/items/ci_preview_review/status', admin, { status: 'rejected' }, admin.csrfToken);
  assert.equal(response.status, 200);
  response = await contentRequest(env, 'PATCH', '/api/content/items/ci_preview_review/status', admin, { status: 'scheduled' }, admin.csrfToken);
  assert.equal(response.status, 422);

  response = await contentRequest(env, 'PATCH', '/api/content/items/ci_preview_drafting/status', admin, { status: 'blocked' }, admin.csrfToken);
  assert.equal(response.status, 200);
  response = await contentRequest(env, 'PATCH', '/api/content/items/ci_preview_drafting/status', admin, { status: 'scheduled' }, admin.csrfToken);
  assert.equal(response.status, 422);
  database.close();
});

// ---------------------------------------------------------------------------
// RED cannot auto-approve / unverified material claim cannot approve (risk-scoped)
// ---------------------------------------------------------------------------

test('RED cannot auto-approve, even via a direct status-transition call attempting to skip past it; green does not block', async () => {
  const database = previewDatabase();
  const env = contentEnvironment(database);
  const admin = await adminSession(env);
  const owner = await ownerSessionD(env);

  // ci_preview_approved_e4la is at 'e4la_approved' with brand brain bb_preview_1's
  // automation_mode='client_approval', so it must go through client_review next.
  let response = await contentRequest(env, 'PATCH', '/api/content/items/ci_preview_approved_e4la/status', admin, { status: 'client_review' }, admin.csrfToken);
  assert.equal(response.status, 200);

  // The client-allowed transition client_review -> approved must be blocked by the
  // unresolved RED claim (clm_preview_red), even though it also carries a resolved
  // GREEN claim (clm_preview_green) which must NOT be what blocks it.
  response = await contentRequest(env, 'PATCH', '/api/content/items/ci_preview_approved_e4la/status', owner, { status: 'approved' }, owner.csrfToken);
  assert.equal(response.status, 422);
  const errorBody = await response.json();
  assert.equal(errorBody.error.code, 'unresolved_risky_claim');

  // Control case: an item with only a resolved GREEN claim (no red) must be able
  // to reach 'approved' - proving the rule is risk-scoped, not a blanket claim block.
  // This item's plan (cip_preview_b) snapshots bb_preview_1 (automation_mode
  // 'client_approval'), so the legitimate path is through client_review, exactly
  // like ci_preview_approved_e4la above - NOT by creating a new brand_brain
  // version to dodge that requirement (that retroactive-policy-change bypass is
  // its own dedicated regression below).
  response = await contentRequest(env, 'POST', '/api/content/items/ci_preview_review/claims', admin, {
    claim_text: 'Fictional green claim with no risk.', risk_level: 'green',
  }, admin.csrfToken);
  assert.equal(response.status, 201);

  response = await contentRequest(env, 'PATCH', '/api/content/items/ci_preview_review/status', admin, { status: 'e4la_approved' }, admin.csrfToken);
  assert.equal(response.status, 200);
  response = await contentRequest(env, 'PATCH', '/api/content/items/ci_preview_review/status', admin, { status: 'client_review' }, admin.csrfToken);
  assert.equal(response.status, 200);
  response = await contentRequest(env, 'PATCH', '/api/content/items/ci_preview_review/status', owner, { status: 'approved' }, owner.csrfToken);
  assert.equal(response.status, 200);
  database.close();
});

// ---------------------------------------------------------------------------
// Plan approval != post approval
// ---------------------------------------------------------------------------

test('Plan approval != post approval: approving a content_plan never changes any content_items.status', async () => {
  const database = previewDatabase();
  const env = contentEnvironment(database);
  const admin = await adminSession(env);

  const before = database.prepare("SELECT id, status FROM content_items WHERE content_plan_id = 'cip_preview_b' ORDER BY id").all();

  const response = await contentRequest(env, 'PATCH', '/api/content/plans/cip_preview_b', admin, { status: 'client_approved' }, admin.csrfToken);
  assert.equal(response.status, 200);

  const after = database.prepare("SELECT id, status FROM content_items WHERE content_plan_id = 'cip_preview_b' ORDER BY id").all();
  assert.deepEqual(before, after);

  const plan = database.prepare("SELECT status FROM content_plans WHERE id = 'cip_preview_b'").get();
  assert.equal(plan.status, 'client_approved');
  database.close();
});

// ---------------------------------------------------------------------------
// Publishing failure != published
// ---------------------------------------------------------------------------

test('Publishing failure != published: a real platform with no connected account fails, never publishes', async () => {
  const database = previewDatabase();
  const env = contentEnvironment(database);
  const admin = await adminSession(env);

  // Move ci_preview_review all the way to 'approved' through the legitimate
  // client_review path (its plan snapshots bb_preview_1, automation_mode
  // 'client_approval' - see the approval-policy-snapshot regression below).
  const owner = await ownerSessionD(env);
  let response = await contentRequest(env, 'PATCH', '/api/content/items/ci_preview_review/status', admin, { status: 'e4la_approved' }, admin.csrfToken);
  assert.equal(response.status, 200);
  response = await contentRequest(env, 'PATCH', '/api/content/items/ci_preview_review/status', admin, { status: 'client_review' }, admin.csrfToken);
  assert.equal(response.status, 200);
  response = await contentRequest(env, 'PATCH', '/api/content/items/ci_preview_review/status', owner, { status: 'approved' }, owner.csrfToken);
  assert.equal(response.status, 200);

  const variantResponse = await contentRequest(env, 'POST', '/api/content/items/ci_preview_review/platform-variants', admin, {
    platform: 'instagram', caption: 'Fictional Instagram caption',
  }, admin.csrfToken);
  assert.equal(variantResponse.status, 201);
  const variant = await variantResponse.json();

  const publishResponse = await contentRequest(env, 'POST', `/api/content/variants/${variant.id}/publish`, admin, {}, admin.csrfToken);
  assert.equal(publishResponse.status, 201);
  const job = await publishResponse.json();
  assert.equal(job.status, 'failed');
  assert.notEqual(job.status, 'published');

  const row = database.prepare('SELECT status, failure_code FROM publishing_jobs WHERE id = ?').get(job.jobId);
  assert.equal(row.status, 'failed');
  assert.equal(row.failure_code, 'platform_not_connected');
  database.close();
});

// ---------------------------------------------------------------------------
// Internal notes/sources hidden from portal
// ---------------------------------------------------------------------------

test('Internal notes/sources hidden from portal: a client-facing GET response never includes internal fields', async () => {
  const database = previewDatabase();
  const env = contentEnvironment(database);
  const owner = await ownerSessionD(env);

  const itemResponse = await contentRequest(env, 'GET', '/api/content/items/ci_preview_published', owner);
  assert.equal(itemResponse.status, 200);
  const item = await itemResponse.json();
  assert.ok(!('internal_notes' in item));
  assert.ok(!('content_sources' in item));
  assert.ok(!('content_claims' in item));
  assert.ok(!JSON.stringify(item).toLowerCase().includes('prompt'));

  const planResponse = await contentRequest(env, 'GET', '/api/content/plans/cip_preview_b', owner);
  assert.equal(planResponse.status, 200);
  const plan = await planResponse.json();
  assert.ok(!('created_by_admin_id' in plan));
  assert.ok(!('brand_brain_id' in plan));
  database.close();
});

// ---------------------------------------------------------------------------
// API never exposes secrets
// ---------------------------------------------------------------------------

test('adobe-adapter.js and publishing-adapters.js contain no hardcoded credential value', async () => {
  const adobeSource = await readFile(new URL('../functions/_shared/adobe-adapter.js', import.meta.url), 'utf8');
  const publishingSource = await readFile(new URL('../functions/_shared/publishing-adapters.js', import.meta.url), 'utf8');
  for (const source of [adobeSource, publishingSource]) {
    assert.doesNotMatch(source, /=\s*['"]sk_[A-Za-z0-9]+['"]/);
    assert.doesNotMatch(source, /=\s*['"]Bearer\s+[A-Za-z0-9._-]{10,}['"]/);
    assert.doesNotMatch(source, /(ADOBE_API_KEY|ACCESS_TOKEN|OAUTH_TOKEN)\s*[:=]\s*['"][A-Za-z0-9._-]{8,}['"]/);
    assert.doesNotMatch(source, /AIzaSy[A-Za-z0-9_-]{10,}/);
  }
});

// ---------------------------------------------------------------------------
// Audit events created
// ---------------------------------------------------------------------------

test('Audit events created: a status transition writes a real audit_events row', async () => {
  const database = previewDatabase();
  const env = contentEnvironment(database);
  const admin = await adminSession(env);

  const response = await contentRequest(env, 'PATCH', '/api/content/items/ci_preview_idea/status', admin, { status: 'researched' }, admin.csrfToken);
  assert.equal(response.status, 200);

  const row = database.prepare(`
    SELECT * FROM audit_events WHERE event_type = 'content_item_status_changed' AND event_data_json LIKE '%ci_preview_idea%'
  `).get();
  assert.ok(row, 'expected an audit_events row for the status transition');
  assert.equal(row.actor_id, 'adm_preview_owner');
  database.close();
});

// ---------------------------------------------------------------------------
// Brand Brain automation-mode gate
// ---------------------------------------------------------------------------

test('Brand Brain: auto_publish_approved_policy requires both explicit flags and e4la_admin (never collaborator)', async () => {
  const database = previewDatabase();
  const env = contentEnvironment(database);
  const admin = await adminSession(env);
  const collaborator = await collaboratorSession(env);

  let response = await contentRequest(env, 'POST', '/api/content/clients/clt_preview_d/brand-brain', admin, {
    automation_mode: 'auto_publish_approved_policy',
  }, admin.csrfToken);
  assert.equal(response.status, 422);

  response = await contentRequest(env, 'POST', '/api/content/clients/clt_preview_d/brand-brain', admin, {
    automation_mode: 'auto_publish_approved_policy', client_agreement_authorizes_auto_publish: true,
  }, admin.csrfToken);
  assert.equal(response.status, 422);

  response = await contentRequest(env, 'POST', '/api/content/clients/clt_preview_d/brand-brain', collaborator, {
    automation_mode: 'auto_publish_approved_policy', client_agreement_authorizes_auto_publish: true, e4la_policy_confirmed: true,
  }, collaborator.csrfToken);
  assert.equal(response.status, 422);

  response = await contentRequest(env, 'POST', '/api/content/clients/clt_preview_d/brand-brain', admin, {
    automation_mode: 'auto_publish_approved_policy', client_agreement_authorizes_auto_publish: true, e4la_policy_confirmed: true,
  }, admin.csrfToken);
  assert.equal(response.status, 201);

  const getResponse = await contentRequest(env, 'GET', '/api/content/clients/clt_preview_d/brand-brain', admin);
  assert.equal(getResponse.status, 200);
  const brain = await getResponse.json();
  assert.equal(brain.automation_mode, 'auto_publish_approved_policy');
  assert.equal(brain.version_number, 2);
  database.close();
});

test('Brand Brain: never UPDATEd - a new POST always appends a new version_number', async () => {
  const database = previewDatabase();
  const env = contentEnvironment(database);
  const admin = await adminSession(env);
  const response = await contentRequest(env, 'POST', '/api/content/clients/clt_preview_d/brand-brain', admin, { automation_mode: 'assisted' }, admin.csrfToken);
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.versionNumber, 2);
  const rowCount = database.prepare("SELECT COUNT(*) AS n FROM brand_brains WHERE client_id = 'clt_preview_d'").get();
  assert.equal(rowCount.n, 2);
  database.close();
});

// ---------------------------------------------------------------------------
// PR #8 parallel adversarial verification. Known policy failures are kept as
// executable TODOs so the secure expectation is ready for Claude's core fix.
// ---------------------------------------------------------------------------

test('draft content cannot jump directly to scheduled', async () => {
  const database = previewDatabase();
  const env = contentEnvironment(database);
  const admin = await adminSession(env);
  const response = await contentRequest(env, 'PATCH', '/api/content/items/ci_preview_drafting/status', admin, { status: 'scheduled' }, admin.csrfToken);
  assert.equal(response.status, 422);
  database.close();
});

test('YELLOW claim without verified evidence cannot approve', async () => {
  const database = previewDatabase();
  const env = contentEnvironment(database);
  const admin = await adminSession(env);
  const owner = await ownerSessionD(env);

  let response = await contentRequest(env, 'POST', '/api/content/items/ci_preview_review/claims', admin, {
    claim_text: 'Material yellow claim with no evidence.', risk_level: 'yellow',
  }, admin.csrfToken);
  assert.equal(response.status, 201);
  response = await contentRequest(env, 'PATCH', '/api/content/items/ci_preview_review/status', admin, { status: 'e4la_approved' }, admin.csrfToken);
  assert.equal(response.status, 200);
  response = await contentRequest(env, 'PATCH', '/api/content/items/ci_preview_review/status', admin, { status: 'client_review' }, admin.csrfToken);
  assert.equal(response.status, 200);
  response = await contentRequest(env, 'PATCH', '/api/content/items/ci_preview_review/status', owner, { status: 'approved' }, owner.csrfToken);
  assert.equal(response.status, 422);
  database.close();
});

test('URL-only or unverified source cannot verify a claim', async () => {
  const database = previewDatabase();
  const env = contentEnvironment(database);
  const admin = await adminSession(env);

  const sourceResponse = await contentRequest(env, 'POST', '/api/content/clients/clt_preview_d/sources', admin, {
    source_type: 'url_reference', url: 'https://example.test/url-alone',
  }, admin.csrfToken);
  const source = await sourceResponse.json();
  const claimResponse = await contentRequest(env, 'POST', '/api/content/items/ci_preview_review/claims', admin, {
    claim_text: 'Claim backed only by a URL.', risk_level: 'yellow', source_id: source.id,
  }, admin.csrfToken);
  const claim = await claimResponse.json();
  const verifyResponse = await contentRequest(env, 'PATCH', `/api/content/claims/${claim.id}/verify`, admin, {
    verification_status: 'verified', source_id: source.id,
  }, admin.csrfToken);
  assert.equal(verifyResponse.status, 422);
  const verifyErrorBody = await verifyResponse.json();
  assert.equal(verifyErrorBody.error.code, 'source_not_verified');
  const claimRow = database.prepare('SELECT verification_status FROM content_claims WHERE id = ?').get(claim.id);
  assert.equal(claimRow.verification_status, 'unverified');

  // Once the same source is explicitly verified through its own admin verify
  // action (not merely by having a url field), the identical claim-verify call
  // succeeds - proving the block above is about the source's verification
  // state, not about url_reference sources being unverifiable in principle.
  const sourceVerifyResponse = await contentRequest(env, 'PATCH', `/api/content/sources/${source.id}/verify`, admin, {
    verification_status: 'verified',
  }, admin.csrfToken);
  assert.equal(sourceVerifyResponse.status, 200);
  const secondVerifyResponse = await contentRequest(env, 'PATCH', `/api/content/claims/${claim.id}/verify`, admin, {
    verification_status: 'verified', source_id: source.id,
  }, admin.csrfToken);
  assert.equal(secondVerifyResponse.status, 200);
  database.close();
});

test('creating a source or claim never auto-sets verification_status - it always starts unverified regardless of a populated url field', async () => {
  const database = previewDatabase();
  const env = contentEnvironment(database);
  const admin = await adminSession(env);

  const sourceResponse = await contentRequest(env, 'POST', '/api/content/clients/clt_preview_d/sources', admin, {
    source_type: 'url_reference', url: 'https://example.test/never-auto-verified',
  }, admin.csrfToken);
  assert.equal(sourceResponse.status, 201);
  const source = await sourceResponse.json();
  assert.equal(source.verificationStatus, 'unverified');
  const sourceRow = database.prepare('SELECT verification_status FROM content_sources WHERE id = ?').get(source.id);
  assert.equal(sourceRow.verification_status, 'unverified');

  const claimResponse = await contentRequest(env, 'POST', '/api/content/items/ci_preview_review/claims', admin, {
    claim_text: 'A claim with a source_id already attached at creation.', risk_level: 'yellow', source_id: source.id,
  }, admin.csrfToken);
  assert.equal(claimResponse.status, 201);
  const claim = await claimResponse.json();
  assert.equal(claim.verificationStatus, 'unverified');
  const claimRow = database.prepare('SELECT verification_status FROM content_claims WHERE id = ?').get(claim.id);
  assert.equal(claimRow.verification_status, 'unverified');

  // And, per the risk-scoped approval gate, this still-unverified yellow claim
  // blocks approval even though its source carries a real url.
  let response = await contentRequest(env, 'PATCH', '/api/content/items/ci_preview_review/status', admin, { status: 'e4la_approved' }, admin.csrfToken);
  assert.equal(response.status, 200);
  response = await contentRequest(env, 'PATCH', '/api/content/items/ci_preview_review/status', admin, { status: 'client_review' }, admin.csrfToken);
  assert.equal(response.status, 200);
  const owner = await ownerSessionD(env);
  response = await contentRequest(env, 'PATCH', '/api/content/items/ci_preview_review/status', owner, { status: 'approved' }, owner.csrfToken);
  assert.equal(response.status, 422);
  database.close();
});

test('RED claim cannot auto-approve even after an admin marks the claim verified - approval policy is not retroactively loosened by a newer brand brain', async () => {
  const database = previewDatabase();
  const env = contentEnvironment(database);
  const admin = await adminSession(env);

  let response = await contentRequest(env, 'PATCH', '/api/content/claims/clm_preview_red/verify', admin, {
    verification_status: 'verified', source_id: 'src_preview_a',
  }, admin.csrfToken);
  assert.equal(response.status, 200);
  response = await contentRequest(env, 'POST', '/api/content/clients/clt_preview_d/brand-brain', admin, {
    automation_mode: 'auto_publish_approved_policy',
    client_agreement_authorizes_auto_publish: true,
    e4la_policy_confirmed: true,
  }, admin.csrfToken);
  assert.equal(response.status, 201);
  // ci_preview_approved_e4la's plan (cip_preview_b) still snapshots bb_preview_1
  // (automation_mode 'client_approval'), so even though the CLIENT's latest brand
  // brain now says auto_publish_approved_policy, this already-in-flight item must
  // still require client_review before 'approved' - a new brand brain version must
  // never retroactively loosen the policy an existing item was created under.
  response = await contentRequest(env, 'PATCH', '/api/content/items/ci_preview_approved_e4la/status', admin, { status: 'approved' }, admin.csrfToken);
  assert.equal(response.status, 422);
  const errorBody = await response.json();
  assert.equal(errorBody.error.code, 'client_review_required');
  database.close();
});

test('existing item keeps the approval policy snapshotted by its plan', async () => {
  const database = previewDatabase();
  const env = contentEnvironment(database);
  const admin = await adminSession(env);

  let response = await contentRequest(env, 'PATCH', '/api/content/items/ci_preview_review/status', admin, { status: 'e4la_approved' }, admin.csrfToken);
  assert.equal(response.status, 200);
  response = await contentRequest(env, 'POST', '/api/content/clients/clt_preview_d/brand-brain', admin, { automation_mode: 'manual' }, admin.csrfToken);
  assert.equal(response.status, 201);
  response = await contentRequest(env, 'PATCH', '/api/content/items/ci_preview_review/status', admin, { status: 'approved' }, admin.csrfToken);
  assert.equal(response.status, 422);
  const errorBody = await response.json();
  assert.equal(errorBody.error.code, 'client_review_required');
  database.close();
});

test('client plan list excludes draft/internal planning records', async () => {
  const database = previewDatabase();
  const env = contentEnvironment(database);
  const owner = await ownerSessionD(env);
  const response = await contentRequest(env, 'GET', '/api/content/clients/clt_preview_d/plans', owner);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.ok(payload.plans.length > 0, 'expected at least one client-visible plan (cip_preview_b/cip_preview_c)');
  assert.ok(payload.plans.every((plan) => !['draft', 'internal_approved'].includes(plan.status)));

  // The same draft plan requested directly by id must 404, not merely be
  // filtered from the list - matching the no-403-confirms-existence pattern.
  const directResponse = await contentRequest(env, 'GET', '/api/content/plans/cip_preview_a', owner);
  assert.equal(directResponse.status, 404);
  database.close();
});

test('verified_live requires external proof and manual export can never self-verify', async () => {
  const database = previewDatabase();
  const env = contentEnvironment(database);
  const admin = await adminSession(env);
  const response = await contentRequest(env, 'PATCH', '/api/content/jobs/pjb_preview_a/verify', admin, {}, admin.csrfToken);
  assert.equal(response.status, 422);
  const errorBody = await response.json();
  assert.equal(errorBody.error.code, 'external_post_id_required');
  const job = database.prepare("SELECT status, external_post_id, verified_at FROM publishing_jobs WHERE id = 'pjb_preview_a'").get();
  assert.equal(job.status, 'published');
  assert.equal(job.external_post_id, null);
  assert.equal(job.verified_at, null);
  database.close();
});

test('verified_live succeeds once real external proof (external_post_id) is supplied, and it is persisted on the job', async () => {
  const database = previewDatabase();
  const env = contentEnvironment(database);
  const admin = await adminSession(env);
  const response = await contentRequest(env, 'PATCH', '/api/content/jobs/pjb_preview_a/verify', admin, {
    external_post_id: 'ig_fictional_post_12345',
  }, admin.csrfToken);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, 'verified_live');
  assert.equal(body.externalPostId, 'ig_fictional_post_12345');
  const job = database.prepare("SELECT status, external_post_id, verified_at FROM publishing_jobs WHERE id = 'pjb_preview_a'").get();
  assert.equal(job.status, 'verified_live');
  assert.equal(job.external_post_id, 'ig_fictional_post_12345');
  assert.ok(job.verified_at);
  database.close();
});
