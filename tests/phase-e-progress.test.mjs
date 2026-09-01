import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createSession } from '../functions/_shared/ops-security.js';
import { onRequest as handleOperationsRequest } from '../functions/api/ops/[[path]].js';

// Phase E: client-visible progress layer (phases, weekly snapshots, performance metrics).
// Exercises functions/api/ops/[[path]].js only through its public request handler.

const migration1 = await readFile(new URL('../migrations/0001_client_operations.sql', import.meta.url), 'utf8');
const migration2 = await readFile(new URL('../migrations/0002_phase_c_preview.sql', import.meta.url), 'utf8');
const migration3 = await readFile(new URL('../migrations/0003_payment_plans_immutable.sql', import.meta.url), 'utf8');
const migration4 = await readFile(new URL('../migrations/0004_project_progress.sql', import.meta.url), 'utf8');
const previewFixture = await readFile(new URL('../fixtures/client-operations.preview.sql', import.meta.url), 'utf8');

function previewDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec(migration1); database.exec(migration2); database.exec(migration3); database.exec(migration4);
  database.exec(previewFixture);
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

async function ownerSession(env) {
  return createSession(env.ENROLLMENT_DB, { actorType: 'client_user', actorId: 'usr_preview_d', clientId: 'clt_preview_d', role: 'client_owner', ttlSeconds: 3600 });
}
async function viewerSession(env) {
  return createSession(env.ENROLLMENT_DB, { actorType: 'client_user', actorId: 'usr_preview_d_viewer', clientId: 'clt_preview_d', role: 'client_viewer', ttlSeconds: 3600 });
}
async function adminSession(env) {
  return createSession(env.ENROLLMENT_DB, { actorType: 'admin_user', actorId: 'adm_preview_owner', role: 'e4la_admin', ttlSeconds: 3600 });
}

test('portal progress/roadmap/weeklyProgress/performanceMetrics only ever include published rows', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const owner = await ownerSession(env);
  const response = await operationsRequest(env, 'GET', '/api/ops/portal', owner);
  assert.equal(response.status, 200);
  const body = await response.json();

  assert.equal(body.roadmap.length, 3, 'phs_d_internal must not appear');
  assert.ok(!body.roadmap.some((phase) => phase.name.includes('Internal-only')));
  assert.equal(body.weeklyProgress.length, 3, 'pgs_d_internal (week 4) must not appear');
  assert.ok(!body.weeklyProgress.some((week) => week.weekNumber === 4));
  assert.equal(body.performanceMetrics.length, 2, 'met_d_internal must not appear');
  assert.ok(!body.performanceMetrics.some((metric) => metric.metricKey === 'internal_only_metric'));
  database.close();
});

test('percentComplete is derived from real published milestone counts, not invented', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const owner = await ownerSession(env);
  const response = await operationsRequest(env, 'GET', '/api/ops/portal', owner);
  const body = await response.json();
  // prj_preview_d has exactly 2 published milestones: mil_d_1 completed, mil_d_2 in_progress -> 1/2 = 50%.
  assert.equal(body.progress.percentComplete, 50);
  assert.equal(body.progress.remainingMilestoneCount, 1);
  assert.equal(body.progress.completedPhaseCount, 1);
  assert.equal(body.progress.totalPhaseCount, 3);
  assert.equal(body.progress.currentPhaseName, 'Visibility foundation');
  assert.equal(body.progress.nextPhaseName, 'Content and experience rollout');
  assert.equal(body.progress.statusLabel, 'Needs Attention', 'phs_d_2 has client_action_required=1');
  assert.ok(body.progress.qualitativeState, 'qualitativeState must always be a non-empty string');
  database.close();
});

test('percentComplete is null (not 0 or fabricated) for a project with zero published milestones, while qualitativeState stays a real string', async () => {
  const database = previewDatabase();
  database.exec("UPDATE project_milestones SET publication_status = 'internal' WHERE project_id = 'prj_preview_d'");
  const env = operationsEnvironment(database);
  const owner = await ownerSession(env);
  const response = await operationsRequest(env, 'GET', '/api/ops/portal', owner);
  const body = await response.json();
  assert.equal(body.progress.percentComplete, null);
  assert.ok(typeof body.progress.qualitativeState === 'string' && body.progress.qualitativeState.length > 0);
  database.close();
});

test('roadmap is ordered by sequence and reports per-phase milestone counts correctly', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const owner = await ownerSession(env);
  const response = await operationsRequest(env, 'GET', '/api/ops/portal', owner);
  const body = await response.json();
  assert.deepEqual(body.roadmap.map((phase) => phase.sequence), [1, 2, 3]);
  assert.deepEqual(body.roadmap.map((phase) => phase.status), ['completed', 'current', 'upcoming']);
  const first = body.roadmap[0];
  assert.equal(first.milestoneCount, 1); assert.equal(first.completedMilestoneCount, 1);
  const second = body.roadmap[1];
  assert.equal(second.milestoneCount, 1); assert.equal(second.completedMilestoneCount, 0);
  assert.equal(second.clientActionRequired, true);
  assert.equal(second.clientActionNote, 'Approve the homepage messaging proof.');
  const third = body.roadmap[2];
  assert.equal(third.milestoneCount, 0); assert.equal(third.clientActionRequired, false);
  database.close();
});

test('weeklyProgress is [] (not null, not omitted) for a project with zero published snapshots, and ordered ascending when present', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const owner = await ownerSession(env);
  let response = await operationsRequest(env, 'GET', '/api/ops/portal', owner);
  let body = await response.json();
  assert.deepEqual(body.weeklyProgress.map((week) => week.weekNumber), [1, 2, 3]);
  assert.equal(body.weeklyProgress[0].percentComplete, 0);
  assert.equal(body.weeklyProgress[2].percentComplete, 40);

  database.exec("UPDATE project_progress_snapshots SET publication_status = 'internal' WHERE project_id = 'prj_preview_d'");
  response = await operationsRequest(env, 'GET', '/api/ops/portal', owner);
  body = await response.json();
  assert.deepEqual(body.weeklyProgress, []);
  database.close();
});

test('performanceMetrics is [] for a project with zero published metrics, and correctly ordered by sort_order when present', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const owner = await ownerSession(env);
  let response = await operationsRequest(env, 'GET', '/api/ops/portal', owner);
  let body = await response.json();
  assert.deepEqual(body.performanceMetrics.map((metric) => metric.metricKey), ['local_visibility', 'technical_issues_resolved']);

  database.exec("UPDATE project_performance_metrics SET publication_status = 'internal' WHERE project_id = 'prj_preview_d'");
  response = await operationsRequest(env, 'GET', '/api/ops/portal', owner);
  body = await response.json();
  assert.deepEqual(body.performanceMetrics, []);
  database.close();
});

test('reviewed and approved (but not published) phases/snapshots/metrics never leak to the client portal', async () => {
  const database = previewDatabase();
  database.exec("UPDATE project_phases SET publication_status = 'reviewed' WHERE id = 'phs_d_3'");
  database.exec("UPDATE project_progress_snapshots SET publication_status = 'approved' WHERE id = 'pgs_d_3'");
  database.exec("UPDATE project_performance_metrics SET publication_status = 'reviewed' WHERE id = 'met_d_tech'");
  const env = operationsEnvironment(database);
  const owner = await ownerSession(env);
  const response = await operationsRequest(env, 'GET', '/api/ops/portal', owner);
  const body = await response.json();
  assert.equal(body.roadmap.length, 2);
  assert.equal(body.weeklyProgress.length, 2);
  assert.equal(body.performanceMetrics.length, 1);
  database.close();
});

test('a withdrawn phase disappears from the portal exactly like an internal one', async () => {
  const database = previewDatabase();
  database.exec("UPDATE project_phases SET publication_status = 'withdrawn' WHERE id = 'phs_d_1'");
  const env = operationsEnvironment(database);
  const owner = await ownerSession(env);
  const response = await operationsRequest(env, 'GET', '/api/ops/portal', owner);
  const body = await response.json();
  assert.equal(body.roadmap.length, 2);
  assert.ok(!body.roadmap.some((phase) => phase.id === 'phs_d_1'));
  database.close();
});

test('cross-client isolation: a different client session never sees prj_preview_d roadmap/metric content', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const otherOwner = await createSession(env.ENROLLMENT_DB, { actorType: 'client_user', actorId: 'usr_preview_other', clientId: 'clt_preview_a', role: 'client_owner', ttlSeconds: 3600 });
  const response = await operationsRequest(env, 'GET', '/api/ops/portal', otherOwner);
  // clt_preview_a's project has no client_visible/activated enrollment reaching this project, so this either
  // 403s (portal not active) or, if it does return, must never contain clt_preview_d's fictional phase content.
  if (response.status === 200) {
    const body = await response.json();
    assert.ok(!JSON.stringify(body).includes('Visibility foundation'));
  } else {
    assert.equal(response.status, 403);
  }
  database.close();
});

test('admin lifecycle: creating a phase/snapshot/metric starts internal (invisible to the client), then publishing makes it visible', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const admin = await adminSession(env);
  const owner = await ownerSession(env);

  let response = await operationsRequest(env, 'POST', '/api/ops/admin/projects/prj_preview_d/phases', admin, {
    name: 'Final reporting', sequence: 5, status: 'upcoming',
  }, admin.csrfToken);
  assert.equal(response.status, 201);
  const phase = await response.json();
  assert.equal(phase.publicationStatus, 'internal');

  let portalCheck = await operationsRequest(env, 'GET', '/api/ops/portal', owner);
  assert.ok(!(await portalCheck.json()).roadmap.some((p) => p.id === phase.id));

  response = await operationsRequest(env, 'POST', '/api/ops/admin/publication', admin, {
    entityType: 'phase', entityId: phase.id, publicationStatus: 'published',
  }, admin.csrfToken);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).publicationStatus, 'published');

  portalCheck = await operationsRequest(env, 'GET', '/api/ops/portal', owner);
  assert.ok((await portalCheck.json()).roadmap.some((p) => p.id === phase.id));

  response = await operationsRequest(env, 'POST', '/api/ops/admin/projects/prj_preview_d/progress-snapshots', admin, {
    week_number: 10, snapshot_date: '2026-09-27', completed_milestones_count: 5, total_milestones_count: 5,
  }, admin.csrfToken);
  assert.equal(response.status, 201);
  const snapshot = await response.json();
  assert.equal(snapshot.publicationStatus, 'internal');

  response = await operationsRequest(env, 'POST', '/api/ops/admin/projects/prj_preview_d/performance-metrics', admin, {
    metric_key: 'new_metric', label: 'New metric', category: 'content', current_value: '5', trend: 'up',
  }, admin.csrfToken);
  assert.equal(response.status, 201);
  const metric = await response.json();
  assert.equal(metric.publicationStatus, 'internal');
  response = await operationsRequest(env, 'PATCH', `/api/ops/admin/performance-metrics/${metric.id}`, admin, { current_value: '9', trend: 'up' }, admin.csrfToken);
  assert.equal(response.status, 200);
  database.close();
});

test('a client session (non-admin) cannot create or patch a phase/snapshot/metric', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const owner = await ownerSession(env);
  let response = await operationsRequest(env, 'POST', '/api/ops/admin/projects/prj_preview_d/phases', owner, { name: 'Forbidden', sequence: 9 }, owner.csrfToken);
  assert.equal(response.status, 403);
  response = await operationsRequest(env, 'PATCH', '/api/ops/admin/phases/phs_d_1', owner, { status: 'blocked' }, owner.csrfToken);
  assert.equal(response.status, 403);
  response = await operationsRequest(env, 'POST', '/api/ops/admin/projects/prj_preview_d/progress-snapshots', owner, { week_number: 20, snapshot_date: '2026-12-01', completed_milestones_count: 1, total_milestones_count: 1 }, owner.csrfToken);
  assert.equal(response.status, 403);
  response = await operationsRequest(env, 'POST', '/api/ops/admin/projects/prj_preview_d/performance-metrics', owner, { metric_key: 'x', label: 'x', current_value: '1' }, owner.csrfToken);
  assert.equal(response.status, 403);
  database.close();
});

test('a forged project ID is rejected with 404 for phase/snapshot/metric creation', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const admin = await adminSession(env);
  let response = await operationsRequest(env, 'POST', '/api/ops/admin/projects/prj_does_not_exist/phases', admin, { name: 'X', sequence: 1 }, admin.csrfToken);
  assert.equal(response.status, 404);
  response = await operationsRequest(env, 'POST', '/api/ops/admin/projects/prj_does_not_exist/progress-snapshots', admin, { week_number: 1, snapshot_date: '2026-01-01', completed_milestones_count: 0, total_milestones_count: 1 }, admin.csrfToken);
  assert.equal(response.status, 404);
  response = await operationsRequest(env, 'POST', '/api/ops/admin/projects/prj_does_not_exist/performance-metrics', admin, { metric_key: 'x', label: 'x', current_value: '1' }, admin.csrfToken);
  assert.equal(response.status, 404);
  database.close();
});

test('project_progress_snapshots values are immutable once created; only publication_status may still change', async () => {
  const database = previewDatabase();
  assert.throws(() => database.exec("UPDATE project_progress_snapshots SET completed_milestones_count = 99 WHERE id = 'pgs_d_1'"), /immutable/);
  assert.throws(() => database.exec("UPDATE project_progress_snapshots SET week_number = 99 WHERE id = 'pgs_d_1'"), /immutable/);
  assert.throws(() => database.exec("DELETE FROM project_progress_snapshots WHERE id = 'pgs_d_1'"), /append-only/);
  assert.doesNotThrow(() => database.exec("UPDATE project_progress_snapshots SET publication_status = 'withdrawn', updated_at = '2026-08-25T00:00:00.000Z' WHERE id = 'pgs_d_1'"));
  database.close();
});

test('PATCH phase ignores project_id/name/sequence and only applies supported fields', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const admin = await adminSession(env);
  const response = await operationsRequest(env, 'PATCH', '/api/ops/admin/phases/phs_d_3', admin, {
    status: 'blocked', name: 'Renamed (should be ignored)', sequence: 99, project_id: 'prj_preview_a',
  }, admin.csrfToken);
  assert.equal(response.status, 200);
  const row = database.prepare("SELECT name, sequence, project_id, status FROM project_phases WHERE id = 'phs_d_3'").get();
  assert.equal(row.name, 'Content and experience rollout');
  assert.equal(row.sequence, 3);
  assert.equal(row.project_id, 'prj_preview_d');
  assert.equal(row.status, 'blocked');
  database.close();
});

test('Admin Preview stays clearly labeled and shows only published progress/roadmap/metric data', async () => {
  const database = previewDatabase();
  const env = operationsEnvironment(database);
  const admin = await adminSession(env);
  const response = await operationsRequest(env, 'GET', `/api/ops/admin/preview/clt_preview_d`, admin);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.adminPreview, true);
  assert.equal(body.label, 'ADMIN PREVIEW');
  assert.equal(body.portal.roadmap.length, 3);
  assert.ok(!body.portal.roadmap.some((phase) => phase.name.includes('Internal-only')));
  assert.equal(body.portal.performanceMetrics.length, 2);
  database.close();
});
