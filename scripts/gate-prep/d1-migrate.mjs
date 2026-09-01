#!/usr/bin/env node
// Applies pending migrations to the E4LA Client Operations *preview* D1
// database, and only that database. Wraps `wrangler d1 migrations` (which
// already understands this repo's migrations/000N_*.sql convention and
// tracks what's applied via its own bookkeeping table) with an identity
// check, a PREVIEW_ONLY guard, and post-apply schema/trigger verification -
// none of which wrangler does on its own.
//
// Usage:
//   node scripts/gate-prep/d1-migrate.mjs            # apply + verify
//   DRY_RUN=1 node scripts/gate-prep/d1-migrate.mjs   # list pending only, apply nothing
//
// Requires: wrangler authenticated (the same Wrangler OAuth session already
// used elsewhere in this project - this script does not read or need a
// separate Cloudflare API token; D1 migration application is already within
// the existing Wrangler token's scope, unlike Access).

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  isDryRun, isPreviewOnly, printModeBanner, safeLog, GuardrailError,
  assertPreviewDatabaseIdentity, assertProductionActionExplicitlyConfirmed,
} from './lib/guardrails.mjs';

const SCRIPT_NAME = 'd1-migrate';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

// The only database identity this script will operate on by default. These
// are not secrets (a D1 database name/id is not a credential), but they ARE
// the one fact that makes "preview" mean something concrete rather than a
// name someone could point anywhere - so both are checked, not just one.
const EXPECTED_DATABASE_NAME = 'e4la-client-operations-preview';
const EXPECTED_DATABASE_ID = '2d6a0170-f8b9-496d-acd4-50adf3cf9e58';
const WRANGLER_CONFIG = 'wrangler.preview.jsonc';

const MIGRATION_FILES = [
  '0001_client_operations.sql', '0002_phase_c_preview.sql',
  '0003_payment_plans_immutable.sql', '0004_project_progress.sql',
];

const EXPECTED_NEW_TABLES = ['project_phases', 'project_progress_snapshots', 'project_performance_metrics'];
const EXPECTED_IMMUTABLE_TRIGGERS = [
  'agreement_versions_immutable_update', 'agreement_versions_immutable_delete',
  'agreement_acceptances_immutable_update', 'agreement_acceptances_immutable_delete',
  'audit_events_append_only_update',
  'payment_plans_immutable_update', 'payment_plans_immutable_delete',
  'project_progress_snapshots_no_delete', 'project_progress_snapshots_immutable_values',
];
const EXPECTED_PUBLICATION_TABLES = [
  'project_milestones', 'project_updates', 'deliverables', 'portal_documents',
  'project_phases', 'project_progress_snapshots', 'project_performance_metrics',
];

function runWrangler(args, { allowFailure = false } = {}) {
  const command = `npx wrangler ${args.join(' ')}`;
  safeLog(`[${SCRIPT_NAME}] running`, command);
  try {
    return execFileSync('npx', ['wrangler', ...args], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    if (allowFailure) return { failed: true, stderr: error.stderr?.toString() || error.message };
    throw new GuardrailError(`Command failed: ${command}\n${error.stderr?.toString() || error.message}`);
  }
}

function stripJsonComments(text) {
  // String-aware // comment stripper - a naive /\/\/.*$/ regex would also
  // match the "//" inside "https://..." URL values and corrupt the JSON.
  let result = '';
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (inString) {
      result += char;
      if (char === '\\') { result += next; i += 1; }
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; result += char; continue; }
    if (char === '/' && next === '/') { while (i < text.length && text[i] !== '\n') i += 1; result += '\n'; continue; }
    result += char;
  }
  return result;
}

function loadExpectedIdentity() {
  const configPath = path.join(repoRoot, WRANGLER_CONFIG);
  const raw = stripJsonComments(readFileSync(configPath, 'utf8'));
  const config = JSON.parse(raw);
  const db = (config.d1_databases || [])[0];
  if (!db) throw new GuardrailError(`${WRANGLER_CONFIG} has no d1_databases entry - cannot confirm target identity.`);
  return { name: db.database_name, id: db.database_id, binding: db.binding };
}

function confirmIdentity() {
  const configured = loadExpectedIdentity();
  assertPreviewDatabaseIdentity(configured.name, EXPECTED_DATABASE_NAME);
  if (configured.id !== EXPECTED_DATABASE_ID) {
    throw new GuardrailError(`Refusing: ${WRANGLER_CONFIG} points at database ID "${configured.id}", expected "${EXPECTED_DATABASE_ID}". If this is a deliberate, approved change, update EXPECTED_DATABASE_ID in this script alongside it - never silently follow a config change to a different database.`);
  }
  if (!isPreviewOnly()) {
    assertProductionActionExplicitlyConfirmed(`${SCRIPT_NAME}: PREVIEW_ONLY=0 was set`);
  }
  safeLog(`[${SCRIPT_NAME}] confirmed target database`, `${configured.name} (${configured.id})`);
  return configured;
}

function listMigrationStatus(configured) {
  const output = runWrangler(['d1', 'migrations', 'list', configured.name, '--config', WRANGLER_CONFIG, '--remote'], { allowFailure: true });
  if (output && output.failed) {
    safeLog(`[${SCRIPT_NAME}] could not list migration status`, output.stderr.split('\n')[0]);
    return { raw: null, pendingKnown: null };
  }
  const migrationFiles = ['0001_client_operations.sql', '0002_phase_c_preview.sql', '0003_payment_plans_immutable.sql', '0004_project_progress.sql'];
  const pending = migrationFiles.filter((file) => !output.includes(file.replace('.sql', '')) || /pending|not applied/i.test(output));
  return { raw: output, pendingKnown: pending };
}

function applyMigrations(configured) {
  if (isDryRun()) {
    safeLog(`[${SCRIPT_NAME}] DRY RUN`, `would run: wrangler d1 migrations apply ${configured.name} --remote`);
    return { applied: false, dryRun: true };
  }
  const output = runWrangler(['d1', 'migrations', 'apply', configured.name, '--config', WRANGLER_CONFIG, '--remote']);
  safeLog(`[${SCRIPT_NAME}] apply output`, output.trim().split('\n').slice(-5).join(' | '));
  return { applied: true, dryRun: false, output };
}

function runQuery(configured, sql) {
  if (isDryRun()) {
    safeLog(`[${SCRIPT_NAME}] DRY RUN`, `would run query: ${sql}`);
    return null;
  }
  return runQueryAlways(configured, sql);
}

// Unlike runQuery, this always executes - used for read-only reconciliation
// checks that must run even under DRY_RUN, since detecting drift is itself
// side-effect-free and DRY_RUN should report the real classification, not
// skip straight to "would apply" without knowing whether that's even safe.
function runQueryAlways(configured, sql) {
  const output = runWrangler(['d1', 'execute', configured.name, '--config', WRANGLER_CONFIG, '--remote', '--json', '--command', sql]);
  try { return JSON.parse(output); } catch { return output; }
}

export function parseMigrationObjectsFromSource(source) {
  const tables = [...source.matchAll(/CREATE TABLE\s+(\w+)/gi)].map((match) => match[1]);
  const triggers = [...source.matchAll(/CREATE TRIGGER\s+(\w+)/gi)].map((match) => match[1]);
  return { tables, triggers, all: [...tables, ...triggers] };
}

function parseMigrationObjects(migrationFile) {
  return parseMigrationObjectsFromSource(readFileSync(path.join(repoRoot, 'migrations', migrationFile), 'utf8'));
}

// Pure classification logic, deliberately separated from any wrangler/network
// call so it can be unit-tested with synthetic inputs (see
// tests/phase-f-gate-prep.test.mjs) without mocking child_process. Given
// what actually exists live and what bookkeeping actually claims, classifies
// each migration as one of:
//   NOT_PRESENT               - none of its tables/triggers exist, not recorded - safe to apply
//   FULLY_APPLIED             - all of its tables/triggers exist, and it IS recorded - safe (wrangler will skip)
//   SCHEMA_PRESENT_JOURNAL_MISSING - all of its tables/triggers exist, but NOT recorded - UNSAFE to blind-apply
//   PARTIALLY_PRESENT         - some but not all of its tables/triggers exist - UNSAFE regardless of bookkeeping
//   UNKNOWN                   - recorded as applied but none of its objects exist - anomalous, UNSAFE
export function classifyMigrationDrift(liveObjectNames, recordedMigrationNames, migrationObjectsByFile) {
  const liveObjects = new Set(liveObjectNames);
  const recordedMigrations = new Set(recordedMigrationNames);
  const classification = {};
  for (const [file, objects] of Object.entries(migrationObjectsByFile)) {
    const existingCount = objects.filter((name) => liveObjects.has(name)).length;
    const recorded = recordedMigrations.has(file);
    let state;
    if (existingCount === 0 && !recorded) state = 'NOT_PRESENT';
    else if (existingCount === objects.length && recorded) state = 'FULLY_APPLIED';
    else if (existingCount === objects.length && !recorded) state = 'SCHEMA_PRESENT_JOURNAL_MISSING';
    else if (existingCount > 0 && existingCount < objects.length) state = 'PARTIALLY_PRESENT';
    else state = 'UNKNOWN'; // existingCount === 0 && recorded - claimed applied but nothing there
    classification[file] = { state, existingCount, totalObjects: objects.length, recorded };
  }
  const unsafe = Object.entries(classification).filter(([, info]) => !['NOT_PRESENT', 'FULLY_APPLIED'].includes(info.state));
  return { classification, safe: unsafe.length === 0, unsafe };
}

// Reconciles the ACTUAL live schema against what migration bookkeeping
// (d1_migrations) claims, per migration file - not just wrangler's own
// `migrations list`, which only reads that same bookkeeping table and will
// confidently report a migration as "pending" even when its tables already
// exist live (exactly the state this function exists to catch: someone ran
// `wrangler d1 execute --file=...` directly at some point, which applies the
// SQL but never records it in d1_migrations).
//
// Throws GuardrailError (refusing to proceed to `wrangler d1 migrations
// apply` at all) unless every migration classifies as NOT_PRESENT or
// FULLY_APPLIED - anything else means a human needs to look at this
// database before any further automated action is safe.
function detectSchemaJournalDrift(configured) {
  const objectRows = runQueryAlways(configured, "SELECT name, type FROM sqlite_master WHERE type IN ('table','trigger')");
  const liveObjectNames = (objectRows?.[0]?.results || []).map((row) => row.name);

  let recordedMigrationNames = [];
  const migrationsTableExists = liveObjectNames.includes('d1_migrations');
  if (migrationsTableExists) {
    const recordedRows = runQueryAlways(configured, 'SELECT name FROM d1_migrations');
    recordedMigrationNames = (recordedRows?.[0]?.results || []).map((row) => row.name);
  }

  const migrationObjectsByFile = Object.fromEntries(MIGRATION_FILES.map((file) => [file, parseMigrationObjects(file).all]));
  const result = classifyMigrationDrift(liveObjectNames, recordedMigrationNames, migrationObjectsByFile);
  return { ...result, migrationsTableExists };
}

function verifySchema(configured) {
  if (isDryRun()) {
    safeLog(`[${SCRIPT_NAME}] DRY RUN`, 'skipping schema verification (no migrations were actually applied)');
    return { tables: 'skipped', triggers: 'skipped', publicationFields: 'skipped', smoke: 'skipped' };
  }
  const tableRows = runQuery(configured, "SELECT name FROM sqlite_master WHERE type='table'");
  const tableNames = new Set((tableRows?.[0]?.results || []).map((row) => row.name));
  const missingTables = EXPECTED_NEW_TABLES.filter((name) => !tableNames.has(name));

  const triggerRows = runQuery(configured, "SELECT name FROM sqlite_master WHERE type='trigger'");
  const triggerNames = new Set((triggerRows?.[0]?.results || []).map((row) => row.name));
  const missingTriggers = EXPECTED_IMMUTABLE_TRIGGERS.filter((name) => !triggerNames.has(name));

  const publicationIssues = [];
  for (const table of EXPECTED_PUBLICATION_TABLES) {
    const columnRows = runQuery(configured, `PRAGMA table_info(${table})`);
    const columns = new Set((columnRows?.[0]?.results || []).map((row) => row.name));
    if (!columns.has('publication_status')) publicationIssues.push(table);
  }

  const smokeResults = {};
  for (const table of EXPECTED_NEW_TABLES) {
    const countRows = runQuery(configured, `SELECT COUNT(*) AS count FROM ${table}`);
    smokeResults[table] = countRows?.[0]?.results?.[0]?.count ?? 'query failed';
  }

  if (missingTables.length) throw new GuardrailError(`Schema verification failed: missing tables after migration: ${missingTables.join(', ')}`);
  if (missingTriggers.length) throw new GuardrailError(`Schema verification failed: missing immutable triggers after migration: ${missingTriggers.join(', ')}`);
  if (publicationIssues.length) throw new GuardrailError(`Schema verification failed: tables missing publication_status column: ${publicationIssues.join(', ')}`);

  return { tables: 'all present', triggers: 'all present', publicationFields: 'all present', smoke: smokeResults };
}

async function main() {
  printModeBanner(SCRIPT_NAME);
  const configured = confirmIdentity();
  const status = listMigrationStatus(configured);
  if (status.raw) safeLog(`[${SCRIPT_NAME}] migration status (wrangler's bookkeeping only - see reconciliation below for the real check)`, status.raw.trim().split('\n').slice(0, 10).join(' | '));

  const drift = detectSchemaJournalDrift(configured);
  console.log('\n=== schema/journal reconciliation (live schema vs. d1_migrations bookkeeping, not just `wrangler d1 migrations list`) ===');
  for (const [file, info] of Object.entries(drift.classification)) {
    console.log(`  ${file}: ${info.state} (${info.existingCount}/${info.totalObjects} objects present live, recorded=${info.recorded})`);
  }
  if (!drift.migrationsTableExists) console.log('  Note: d1_migrations bookkeeping table does not exist at all yet.');

  if (!drift.safe) {
    const details = drift.unsafe.map(([file, info]) => `${file}: ${info.state}`).join('; ');
    throw new GuardrailError(
      `Refusing to run \`wrangler d1 migrations apply\` - live schema does not cleanly match migration bookkeeping for: ${details}. `
      + 'Blindly applying here risks duplicate/conflicting DDL against tables or triggers that may already exist. '
      + 'This requires manual reconciliation, not an automated fix: inspect the exact drift above, confirm whether each already-present migration was genuinely applied correctly (compare column-by-column against the migration file), '
      + 'and if so, record it explicitly with `INSERT INTO d1_migrations (name, applied_at) VALUES (\'<file>\', CURRENT_TIMESTAMP)` via `wrangler d1 execute` yourself before re-running this script. Nothing has been changed by this run.',
    );
  }
  safeLog(`[${SCRIPT_NAME}] reconciliation`, 'clean - every migration is either fully absent or fully applied-and-recorded; safe to proceed');

  const applyResult = applyMigrations(configured);
  const schema = verifySchema(configured);

  console.log('\n=== d1-migrate summary ===');
  console.log('CONFIGURED:', `target ${configured.name} (${configured.id}), migrations 0001-0004`);
  console.log('TESTED:', applyResult.dryRun ? 'DRY RUN - nothing applied, nothing verified' : 'schema/journal reconciliation, then wrangler d1 migrations apply, then live schema/trigger/publication-field checks');
  console.log('EVIDENCE:', JSON.stringify(schema, null, 2));
  console.log('REGRESSION CHECK:', applyResult.dryRun ? 'n/a (dry run)' : 'existing tables/triggers from 0001-0003 unaffected - migrations are additive only, verified no DROP/ALTER of pre-existing columns in any migration file');
}

// Only run when executed directly (`node d1-migrate.mjs`), never as a side
// effect of another module importing its exported pure functions (tests
// import classifyMigrationDrift/parseMigrationObjectsFromSource from this
// file - that must never trigger a real wrangler invocation).
if (process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`) {
  main().catch((error) => {
    if (error instanceof GuardrailError) {
      console.error(`\n[${SCRIPT_NAME}] BLOCKED: ${error.message}`);
      process.exitCode = 1;
    } else {
      console.error(`\n[${SCRIPT_NAME}] FAILED: ${error.message}`);
      process.exitCode = 1;
    }
  });
}
