#!/usr/bin/env node
// Runs the full external-gate sequence in order, stopping at the first gate
// that fails and printing exactly how far it got so a re-run resumes there
// rather than repeating already-passed gates. Never advances past a failed
// gate under any flag.
//
// Usage:
//   node scripts/gate-prep/orchestrator.mjs                 # run every gate from the start
//   node scripts/gate-prep/orchestrator.mjs --from=stripe    # resume from a named gate
//   DRY_RUN=1 node scripts/gate-prep/orchestrator.mjs        # dry-run every gate that supports it
//
// Each gate is a separate `node scripts/gate-prep/<file>.mjs` process, run
// with this process's environment inherited unchanged (no env var is read,
// modified, or synthesized here - each script owns its own credential
// requirements and guardrails; the orchestrator only sequences them).

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { isDryRun, printModeBanner, safeLog } from './lib/guardrails.mjs';

const SCRIPT_NAME = 'orchestrator';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const RESUME_STATE_PATH = path.join(__dirname, '.orchestrator-state.json');

// Order matters. Each gate's `run` script is what actually executes;
// `dryRunCapable: false` means the script has no dedicated dry-run behavior
// of its own (e.g. read-only smoke tests are already side-effect-free) and
// DRY_RUN has no effect on it either way.
const GATES = [
  {
    key: 'credential-check',
    label: 'Credential validation',
    run: null, // handled inline below - see validateCredentialsPresent()
  },
  {
    key: 'cloudflare-access',
    label: 'Cloudflare Access setup',
    script: 'cloudflare-access-setup.mjs',
    requiredEnv: ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'],
  },
  {
    key: 'd1-migrations',
    label: 'Preview D1 migrations',
    script: 'd1-migrate.mjs',
    requiredEnv: [],
  },
  {
    key: 'access-smoke-test',
    label: 'Access smoke tests (post-deployment)',
    script: 'access-smoke-test.mjs',
    requiredEnv: [],
  },
  {
    key: 'stripe-provision',
    label: 'Stripe Sandbox provisioning',
    script: 'stripe-sandbox-provision.mjs',
    requiredEnv: ['STRIPE_SECRET_KEY'],
  },
  {
    key: 'stripe-validation',
    label: 'Stripe Sandbox validation suite',
    script: 'stripe-validation-suite.mjs',
    requiredEnv: ['STRIPE_SECRET_KEY'],
  },
  {
    key: 'resend-preview',
    label: 'Resend preview dispatch validation',
    script: 'resend-preview-dispatch.mjs',
    requiredEnv: ['RESEND_PREVIEW_ALLOWLIST'],
  },
];

function parseArgs() {
  const fromArg = process.argv.find((arg) => arg.startsWith('--from='));
  return { from: fromArg ? fromArg.split('=')[1] : null };
}

function loadResumeState() {
  if (!existsSync(RESUME_STATE_PATH)) return { lastPassed: null };
  try { return JSON.parse(readFileSync(RESUME_STATE_PATH, 'utf8')); } catch { return { lastPassed: null }; }
}

function saveResumeState(state) {
  writeFileSync(RESUME_STATE_PATH, JSON.stringify(state, null, 2));
}

function validateCredentialsPresent(fromIndex) {
  const missingByGate = [];
  for (const gate of GATES.slice(fromIndex)) {
    if (!gate.requiredEnv || !gate.requiredEnv.length) continue;
    const missing = gate.requiredEnv.filter((name) => !process.env[name]);
    if (missing.length) missingByGate.push({ gate: gate.key, missing });
  }
  return missingByGate;
}

function runGateScript(gate) {
  const scriptPath = path.join(__dirname, gate.script);
  safeLog(`[${SCRIPT_NAME}] running gate`, `${gate.key} (${gate.script})`);
  try {
    const output = execFileSync('node', [scriptPath], {
      cwd: repoRoot, encoding: 'utf8', stdio: 'inherit', env: process.env,
    });
    return { passed: true, output };
  } catch (error) {
    return { passed: false, error: error.message };
  }
}

async function main() {
  printModeBanner(SCRIPT_NAME);
  const { from } = parseArgs();
  const resumeState = loadResumeState();

  let startIndex = 0;
  if (from) {
    startIndex = GATES.findIndex((gate) => gate.key === from);
    if (startIndex === -1) {
      console.error(`[${SCRIPT_NAME}] unknown gate "${from}". Known gates: ${GATES.map((gate) => gate.key).join(', ')}`);
      process.exitCode = 1;
      return;
    }
  } else if (resumeState.lastPassed) {
    const lastPassedIndex = GATES.findIndex((gate) => gate.key === resumeState.lastPassed);
    startIndex = lastPassedIndex + 1;
    if (startIndex > 0) safeLog(`[${SCRIPT_NAME}] resuming after last-passed gate`, resumeState.lastPassed);
  }

  console.log(`\n=== External-gate sequence: starting at "${GATES[startIndex].key}" ===\n`);

  // Preflight: report every missing credential across the WHOLE remaining
  // sequence up front, so a run doesn't fail one gate at a time over many
  // separate invocations when the real answer is "none of this is possible
  // yet." Still runs gate-by-gate below - this is reporting, not a skip.
  const missingCredentials = validateCredentialsPresent(startIndex);
  if (missingCredentials.length) {
    console.log('Preflight credential check (informational - gates will still run and fail individually with their own clear message):');
    for (const entry of missingCredentials) console.log(`  - ${entry.gate}: missing ${entry.missing.join(', ')}`);
    console.log('');
  }

  const results = [];
  for (let index = startIndex; index < GATES.length; index += 1) {
    const gate = GATES[index];
    if (gate.key === 'credential-check') { results.push({ key: gate.key, label: gate.label, passed: true, note: 'see preflight report above' }); continue; }

    const result = runGateScript(gate);
    results.push({ key: gate.key, label: gate.label, passed: result.passed });

    if (!result.passed) {
      saveResumeState({ lastPassed: results.filter((r) => r.passed).slice(-1)[0]?.key ?? null });
      console.log(`\n=== STOPPED at gate "${gate.key}" (${gate.label}) — did not pass ===`);
      console.log('Re-run this orchestrator after resolving the failure; it will resume from here automatically (or pass --from=' + gate.key + ' explicitly).');
      printSummary(results);
      process.exitCode = 1;
      return;
    }
    saveResumeState({ lastPassed: gate.key });
  }

  console.log('\n=== All gates in this run completed ===');
  printSummary(results);
}

function printSummary(results) {
  console.log('\nGate status:');
  for (const result of results) {
    console.log(`  ${result.passed ? 'PASSED' : 'FAILED'}  ${result.key} - ${result.label}`);
  }
}

main().catch((error) => {
  console.error(`\n[${SCRIPT_NAME}] FAILED: ${error.message}`);
  process.exitCode = 1;
});
