import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { onRequest as handleOperationsRequest } from '../functions/api/ops/[[path]].js';
import { createSession } from '../functions/_shared/ops-security.js';

// Phase D scope: agreement immutability audit. functions/api/ops/[[path]].js is exercised
// read-only through its public request handler here (never edited by this file directly).

const migration1 = await readFile(new URL('../migrations/0001_client_operations.sql', import.meta.url), 'utf8');
const migration2 = await readFile(new URL('../migrations/0002_phase_c_preview.sql', import.meta.url), 'utf8');
const migration3 = await readFile(new URL('../migrations/0003_payment_plans_immutable.sql', import.meta.url), 'utf8');
const migration4 = await readFile(new URL('../migrations/0004_project_progress.sql', import.meta.url), 'utf8');
const previewFixture = await readFile(new URL('../fixtures/client-operations.preview.sql', import.meta.url), 'utf8');
const opsRouterSource = await readFile(new URL('../functions/api/ops/[[path]].js', import.meta.url), 'utf8');

function previewDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec(migration1);
  database.exec(migration2);
  database.exec(migration3);
  database.exec(migration4);
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

test('an agreement acceptance snapshot captures its own version legal text, hash, and payment plan amounts at acceptance time', () => {
  const database = previewDatabase();
  const version = database.prepare("SELECT * FROM agreement_versions WHERE id = 'agrv_preview_b'").get();
  const plan = database.prepare("SELECT * FROM payment_plans WHERE id = 'plan_preview_b'").get();
  const acceptance = database.prepare("SELECT * FROM agreement_acceptances WHERE id = 'acc_preview_b'").get();

  assert.equal(acceptance.agreement_version_id, version.id);
  assert.equal(acceptance.legal_document_hash, version.legal_document_hash);
  assert.equal(acceptance.rendered_agreement_snapshot, version.rendered_agreement_snapshot);
  assert.equal(acceptance.total_contract_value, plan.total_contract_value);
  assert.deepEqual(JSON.parse(acceptance.installment_amounts_json).reduce((sum, value) => sum + value, 0), plan.total_contract_value);
  database.close();
});

test('creating a new agreement_version for the same agreement never alters the already-accepted evidence', () => {
  const database = previewDatabase();
  const before = database.prepare("SELECT * FROM agreement_acceptances WHERE id = 'acc_preview_b'").get();

  // Simulate an admin later editing the commercial terms / legal text template for agr_preview_b
  // (the same operation createAgreement performs when producing a version 1 record).
  database.exec(`
    INSERT INTO agreement_versions (
      id, agreement_id, version_number, legal_document_hash, rendered_agreement_snapshot,
      agreement_summary_json, commercial_terms_json, acknowledgement_clauses_json, created_at
    ) VALUES (
      'agrv_preview_b_v2', 'agr_preview_b', 2, 'phase-c-fixture-hash-b-v2',
      'PHASE C LEGAL PLACEHOLDER — REWRITTEN TEMPLATE (SHOULD NEVER REACH THE ACCEPTED RECORD)',
      '{"initialTerm":"90 Days","totalInvestment":999999}', '{"currency":"usd","programType":"fixed_program","legalStatus":"phase_c_placeholder"}',
      '[]', '2026-08-25T00:00:00.000Z'
    );
    INSERT INTO payment_plans (
      id, agreement_version_id, plan_code, display_name, total_contract_value, currency,
      installment_count, interval_unit, interval_count, installment_schedule_json, active, created_at
    ) VALUES (
      'plan_preview_b_v2', 'agrv_preview_b_v2', 'pay_full', 'Pay in Full', 999999, 'usd',
      1, 'one_time', 0, '[{"amount":999999,"offsetUnit":"month","offset":0}]', 1, '2026-08-25T00:00:00.000Z'
    );
    UPDATE agreements SET current_version_id = 'agrv_preview_b_v2', updated_at = '2026-08-25T00:00:00.000Z' WHERE id = 'agr_preview_b';
  `);

  const after = database.prepare("SELECT * FROM agreement_acceptances WHERE id = 'acc_preview_b'").get();
  assert.deepEqual(after, before, 'the accepted evidence row must be byte-for-byte unchanged after the template moves on');
  assert.doesNotMatch(after.rendered_agreement_snapshot, /REWRITTEN TEMPLATE/);
  assert.equal(after.total_contract_value, 360000);

  const agreement = database.prepare("SELECT accepted_version_id, current_version_id FROM agreements WHERE id = 'agr_preview_b'").get();
  assert.equal(agreement.accepted_version_id, 'agrv_preview_b', 'accepted_version_id must keep pointing at the version that was actually accepted');
  assert.equal(agreement.current_version_id, 'agrv_preview_b_v2', 'current_version_id may move forward for future invitations/acceptances');
  database.close();
});

test('re-deriving the accepted agreement by joining on accepted_version_id (not current_version_id) still resolves the original snapshot, matching how the ops router reads accepted history', () => {
  // This mirrors the exact join pattern functions/api/ops/[[path]].js uses at the
  // "agreements a LEFT JOIN agreement_versions av ON av.id = a.accepted_version_id" call site
  // (portal/admin history), confirming it is anchored to the immutable accepted version, not
  // whatever template is current.
  const database = previewDatabase();
  database.exec(`
    INSERT INTO agreement_versions (
      id, agreement_id, version_number, legal_document_hash, rendered_agreement_snapshot,
      agreement_summary_json, commercial_terms_json, acknowledgement_clauses_json, created_at
    ) VALUES (
      'agrv_preview_b_v2', 'agr_preview_b', 2, 'phase-c-fixture-hash-b-v2',
      'REWRITTEN TEMPLATE', '{}', '{}', '[]', '2026-08-25T00:00:00.000Z'
    );
    UPDATE agreements SET current_version_id = 'agrv_preview_b_v2' WHERE id = 'agr_preview_b';
  `);
  const resolved = database.prepare(`
    SELECT a.id, av.version_number, av.rendered_agreement_snapshot
    FROM agreements a LEFT JOIN agreement_versions av ON av.id = a.accepted_version_id
    WHERE a.id = 'agr_preview_b'
  `).get();
  assert.equal(resolved.version_number, 1);
  assert.doesNotMatch(resolved.rendered_agreement_snapshot, /REWRITTEN TEMPLATE/);
  database.close();
});

test('agreement_versions and agreement_acceptances reject UPDATE and DELETE on every evidence column, not just the ones phase-c already covers', () => {
  const database = previewDatabase();
  assert.throws(() => database.exec("UPDATE agreement_versions SET rendered_agreement_snapshot = 'changed' WHERE id = 'agrv_preview_b'"), /immutable/);
  assert.throws(() => database.exec("UPDATE agreement_versions SET agreement_summary_json = '{}' WHERE id = 'agrv_preview_b'"), /immutable/);
  assert.throws(() => database.exec("DELETE FROM agreement_versions WHERE id = 'agrv_preview_b'"), /immutable/);
  assert.throws(() => database.exec("UPDATE agreement_acceptances SET total_contract_value = 1 WHERE id = 'acc_preview_b'"), /immutable/);
  assert.throws(() => database.exec("UPDATE agreement_acceptances SET installment_amounts_json = '[1]' WHERE id = 'acc_preview_b'"), /immutable/);
  assert.throws(() => database.exec("DELETE FROM agreement_acceptances WHERE id = 'acc_preview_b'"), /immutable/);
  database.close();
});

test('a second acceptance of the same agreement/version is rejected at the schema level (no double-accept)', () => {
  const database = previewDatabase();
  assert.throws(() => database.exec(`
    INSERT INTO agreement_acceptances (
      id, agreement_id, agreement_version_id, client_id, project_id, payment_plan_id,
      legal_document_hash, rendered_agreement_snapshot, total_contract_value,
      installment_amounts_json, installment_dates_json, acknowledged_clause_ids_json,
      authorized_signer_name, authorized_signer_role, signer_company, typed_acceptance,
      authority_confirmed, accepted_at_utc, request_id, created_at
    ) VALUES (
      'acc_preview_b_duplicate', 'agr_preview_b', 'agrv_preview_b', 'clt_preview_b', 'prj_preview_b', 'plan_preview_b',
      'phase-c-fixture-hash-b', 'duplicate attempt', 360000, '[360000]', '["2026-08-20T00:00:00.000Z"]', '[]',
      'Someone Else', 'Owner', 'Fictional Company B', 'Someone Else', 1, '2026-08-21T00:00:00.000Z', 'duplicate-req', '2026-08-21T00:00:00.000Z'
    )`), /UNIQUE constraint failed/);
  database.close();
});

// --- Payment plan mutability ---
//
// Fixed: migrations/0003_payment_plans_immutable.sql adds the same immutable-update/delete
// trigger pattern agreement_versions and agreement_acceptances already had, closing the gap
// where a plan referenced by an existing agreement could still be edited after the fact.

test('payment_plans rejects UPDATE and DELETE once the 0003 immutability migration is applied', () => {
  assert.match(migration3, /CREATE TRIGGER payment_plans_immutable_update/);
  const database = previewDatabase();
  assert.throws(() => database.exec("UPDATE payment_plans SET total_contract_value = 1 WHERE id = 'plan_preview_b'"), /immutable/);
  assert.throws(() => database.exec("DELETE FROM payment_plans WHERE id = 'plan_preview_b'"), /immutable/);
  database.close();
});

test('agreement_acceptances holds its own independent copy of the amounts, not a live reference to payment_plans', () => {
  const database = previewDatabase();
  const plan = database.prepare("SELECT total_contract_value FROM payment_plans WHERE id = 'plan_preview_b'").get();
  const acceptance = database.prepare("SELECT total_contract_value, installment_amounts_json FROM agreement_acceptances WHERE id = 'acc_preview_b'").get();
  assert.equal(acceptance.total_contract_value, plan.total_contract_value);
  assert.deepEqual(JSON.parse(acceptance.installment_amounts_json), [360000]);
  database.close();
});

// --- Invitation-sending placeholder gate ---
//
// Fixed: createAgreementInvite now rejects with 409 agreement_legal_unapproved when the
// agreement's current_version_id points at a version whose commercial_terms_json.legalStatus
// is not 'approved'. Every version created by createAgreement is stamped 'phase_c_placeholder'
// today, so this closes off real invitations while legal text remains unapproved (handoff
// section M) without touching any other eligibility check.

test('createAgreementInvite rejects sending a real invitation while the agreement version is still placeholder legal text', async () => {
  // agr_preview_a is 'sent' with no accepted_version_id yet, so status eligibility alone
  // would allow re-sending an invite here — the legalStatus gate must be what blocks it.
  const database = previewDatabase();
  const before = database.prepare("SELECT status FROM agreements WHERE id = 'agr_preview_a'").get();
  assert.equal(before.status, 'sent');
  const env = operationsEnvironment(database);
  const admin = await createSession(env.ENROLLMENT_DB, {
    actorType: 'admin_user', actorId: 'adm_preview_owner', role: 'e4la_admin', ttlSeconds: 3600,
  });
  const response = await operationsRequest(env, 'POST', '/api/ops/admin/agreements/agr_preview_a/invites', admin, {}, admin.csrfToken);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, 'agreement_legal_unapproved');
  const after = database.prepare("SELECT status FROM agreements WHERE id = 'agr_preview_a'").get();
  assert.equal(after.status, before.status, 'a rejected invite attempt must not mutate agreement status');
  database.close();
});

test('createAgreementInvite succeeds once a new version stamped legalStatus approved becomes current', async () => {
  const database = previewDatabase();
  database.exec(`
    INSERT INTO agreement_versions (
      id, agreement_id, version_number, legal_document_hash, rendered_agreement_snapshot,
      agreement_summary_json, commercial_terms_json, acknowledgement_clauses_json, created_at
    ) VALUES (
      'agrv_preview_a_approved', 'agr_preview_a', 2, 'approved-fixture-hash',
      'FINAL APPROVED AGREEMENT TEXT', '{"initialTerm":"90 Days","totalInvestment":360000}',
      '{"currency":"usd","programType":"fixed_program","legalStatus":"approved"}', '[]', '2026-08-25T00:00:00.000Z'
    );
    UPDATE agreements SET current_version_id = 'agrv_preview_a_approved' WHERE id = 'agr_preview_a';
  `);
  const env = operationsEnvironment(database);
  const admin = await createSession(env.ENROLLMENT_DB, {
    actorType: 'admin_user', actorId: 'adm_preview_owner', role: 'e4la_admin', ttlSeconds: 3600,
  });
  const response = await operationsRequest(env, 'POST', '/api/ops/admin/agreements/agr_preview_a/invites', admin, {}, admin.csrfToken);
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.ok(body.invitationUrl);
  database.close();
});
