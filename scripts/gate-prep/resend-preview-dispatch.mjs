#!/usr/bin/env node
// Manual exercise script for scripts/gate-prep/lib/resend-dispatch.mjs.
//
// Runs the full dispatch layer against an in-memory D1 stand-in (node:sqlite
// DatabaseSync) so a human can see exactly what each of the six Client
// Operations templates would send, without a Cloudflare Pages Functions
// runtime and without ever needing the live application. Default behavior
// (SEND_FOR_REAL unset) never calls the real Resend network endpoint - see
// scripts/gate-prep/lib/resend-dispatch.mjs for the guarantee.
//
// Usage:
//   ENVIRONMENT=preview \
//   RESEND_PREVIEW_ALLOWLIST=fictional-client@example.test \
//   RESEND_PREVIEW_SENDER='E4LA Preview <preview@e4la-preview.test>' \
//   RESEND_PREVIEW_API_KEY=fake_key_not_real \
//   node scripts/gate-prep/resend-preview-dispatch.mjs

import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { dispatchOperationsEmail } from './lib/resend-dispatch.mjs';
import { GuardrailError, optionalEnv, printModeBanner, requireEnv, safeLog } from './lib/guardrails.mjs';

const SCRIPT_NAME = 'resend-preview-dispatch';

const ALL_TYPES = [
  'agreement_invitation', 'agreement_accepted', 'payment_confirmation',
  'payment_failure', 'portal_activation', 'onboarding_instructions',
];

function exampleInputFor(type) {
  // Mirrors the fictional fixture pattern used in tests/phase-d-email.test.mjs
  // (ALL_TYPES loop) - clearly-fictional client/program data only.
  return {
    clientName: 'Fictional Client',
    programName: `Preview Program (${type})`,
    actionUrl: 'https://preview.example/action',
    paymentSummary: 'Fictional payment summary for preview exercise.',
    nextStep: 'Fictional next step for preview exercise.',
    supportEmail: 'hello@e4la.org',
  };
}

function d1Adapter(database) {
  const wrap = (sql) => {
    let values = [];
    return {
      bind(...next) { values = next; return this; },
      async first() { return database.prepare(sql).get(...values) || null; },
      async all() { return { results: database.prepare(sql).all(...values) }; },
      async run() { return database.prepare(sql).run(...values); },
    };
  };
  return { prepare: wrap };
}

async function freshPreviewDatabase() {
  const database = new DatabaseSync(':memory:');
  const migrationFiles = [
    '0001_client_operations.sql', '0002_phase_c_preview.sql',
    '0003_payment_plans_immutable.sql', '0004_project_progress.sql',
  ];
  for (const file of migrationFiles) {
    const sql = await readFile(new URL(`../../migrations/${file}`, import.meta.url), 'utf8');
    database.exec(sql);
  }
  return database;
}

function buildEnvironment(database) {
  return {
    ENVIRONMENT: requireEnv('ENVIRONMENT'),
    RESEND_PREVIEW_API_KEY: requireEnv('RESEND_PREVIEW_API_KEY'),
    RESEND_PREVIEW_SENDER: requireEnv('RESEND_PREVIEW_SENDER'),
    RESEND_PREVIEW_ALLOWLIST: requireEnv('RESEND_PREVIEW_ALLOWLIST'),
    ENROLLMENT_DB: d1Adapter(database),
  };
}

async function main() {
  printModeBanner(SCRIPT_NAME);
  safeLog(`[${SCRIPT_NAME}] SEND_FOR_REAL`, optionalEnv('SEND_FOR_REAL', '0'));

  const allowlistRaw = requireEnv('RESEND_PREVIEW_ALLOWLIST');
  const allowlist = allowlistRaw.split(',').map((entry) => entry.trim()).filter(Boolean);
  safeLog(`[${SCRIPT_NAME}] allowlist entries`, allowlist.length);
  if (allowlist.length === 0) {
    console.log(`[${SCRIPT_NAME}] RESEND_PREVIEW_ALLOWLIST is empty. Refusing to invent a fictional recipient - `
      + 'set RESEND_PREVIEW_ALLOWLIST to a real controlled/fictional preview address (e.g. someone@example.test) and re-run.');
    process.exitCode = 1;
    return;
  }
  const recipient = allowlist[0];
  safeLog(`[${SCRIPT_NAME}] recipient`, recipient);

  const database = await freshPreviewDatabase();
  const env = buildEnvironment(database);

  const tested = [];
  const evidence = [];

  for (const type of ALL_TYPES) {
    const idempotencyKey = `preview-dispatch-demo:${type}:${Date.now()}`;
    console.log(`\n[${SCRIPT_NAME}] --- dispatching template "${type}" ---`);
    const result = await dispatchOperationsEmail(env, {
      type,
      input: exampleInputFor(type),
      idempotencyKey,
      clientId: null,
      agreementId: null,
      enrollmentId: null,
      recipientEmail: recipient,
    });
    safeLog(`[${SCRIPT_NAME}] dispatch result`, JSON.stringify(result));
    tested.push(type);
    evidence.push({ type, idempotencyKey, result });

    if (type === ALL_TYPES[0]) {
      // Demonstrate/prove idempotency: re-run the exact same call (same
      // idempotencyKey) for this one type and confirm it is a no-op.
      console.log(`\n[${SCRIPT_NAME}] --- re-dispatching "${type}" with the SAME idempotencyKey to prove idempotency ---`);
      const duplicateResult = await dispatchOperationsEmail(env, {
        type,
        input: exampleInputFor(type),
        idempotencyKey,
        clientId: null,
        agreementId: null,
        enrollmentId: null,
        recipientEmail: recipient,
      });
      safeLog(`[${SCRIPT_NAME}] duplicate dispatch result`, JSON.stringify(duplicateResult));
      if (duplicateResult.status === 'duplicate_sent') {
        console.log(`[${SCRIPT_NAME}] IDEMPOTENCY CHECK: PASS - duplicate call detected and skipped without a second send.`);
      } else if (duplicateResult.status === 'suppressed' && optionalEnv('SEND_FOR_REAL', '0') !== '1') {
        // In default (suppressed) mode the first row never reaches 'sent', so
        // the second call legitimately treats it as a retry of a pending/
        // suppressed row rather than a true duplicate-of-a-sent-message. That
        // is still correct idempotency behavior (no second network attempt
        // was made either time), but flag it clearly either way.
        console.log(`[${SCRIPT_NAME}] IDEMPOTENCY CHECK: retry-of-non-sent-row path exercised (expected in default suppressed mode, since nothing ever reached 'sent').`);
      }
      evidence.push({ type: `${type} (duplicate)`, idempotencyKey, result: duplicateResult });
    }
  }

  console.log(`\n[${SCRIPT_NAME}] ==================== SUMMARY ====================`);
  console.log(`CONFIGURED: ENVIRONMENT=${env.ENVIRONMENT}, SEND_FOR_REAL=${optionalEnv('SEND_FOR_REAL', '0')}, allowlist size=${allowlist.length}`);
  console.log(`TESTED: ${tested.join(', ')}`);
  console.log('EVIDENCE:');
  for (const item of evidence) {
    console.log(`  - ${item.type}: idempotencyKey=${item.idempotencyKey} -> status=${item.result.status}, messageEventId=${item.result.messageEventId}`);
  }
  const rows = await env.ENROLLMENT_DB.prepare('SELECT status, COUNT(*) as count FROM outbound_message_events GROUP BY status').all();
  console.log('REGRESSION CHECK: outbound_message_events row counts by status:', JSON.stringify(rows.results));
  const sentWithoutSendForReal = rows.results.find((row) => row.status === 'sent');
  if (optionalEnv('SEND_FOR_REAL', '0') !== '1' && sentWithoutSendForReal) {
    console.log(`[${SCRIPT_NAME}] REGRESSION CHECK: FAIL - a row reached status='sent' without SEND_FOR_REAL=1. This must never happen.`);
    process.exitCode = 1;
  } else {
    console.log(`[${SCRIPT_NAME}] REGRESSION CHECK: PASS - no row reached status='sent' without SEND_FOR_REAL=1.`);
  }
}

main().catch((error) => {
  if (error instanceof GuardrailError) {
    console.error(`[${SCRIPT_NAME}] Guardrail refused to run: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  console.error(`[${SCRIPT_NAME}] Failed:`, error && error.message ? error.message : error);
  process.exitCode = 1;
});
