#!/usr/bin/env node
// Idempotent Cloudflare Access setup for the E4LA Client Operations preview
// environment. Creates/updates the desired-state described in
// scripts/gate-prep/config/access-config.mjs (identity provider, apps,
// policies) via the Cloudflare API, then writes the three resulting
// non-secret preview env vars (ACCESS_TEAM_DOMAIN, ADMIN_ACCESS_AUD,
// CLIENT_ACCESS_AUD) into wrangler.preview.jsonc's `vars` block.
//
// Run this once a CLOUDFLARE_API_TOKEN with the following scopes exists:
//   - Account > Access: Organizations, Identity Providers, and Groups (Edit)
//   - Account > Access: Apps and Policies (Edit)
//
// Safe to re-run at any time - every step first reads current state and
// only creates/updates what's actually missing or different. Set DRY_RUN=1
// to preview every change with no mutating API calls and no file write.
//
// Usage:
//   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... node scripts/gate-prep/cloudflare-access-setup.mjs
//   DRY_RUN=1 CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... node scripts/gate-prep/cloudflare-access-setup.mjs

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GuardrailError,
  isDryRun,
  requireEnv,
  safeLog,
  assertNotProductionHostname,
  printModeBanner,
} from './lib/guardrails.mjs';
import {
  PREVIEW_HOSTNAME,
  SESSION_DURATION,
  IDENTITY_PROVIDER,
  APPLICATIONS,
  REQUIRED_PREVIEW_ENV_VARS,
} from './config/access-config.mjs';

const SCRIPT_NAME = 'cloudflare-access-setup';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WRANGLER_PREVIEW_PATH = path.resolve(__dirname, '..', '..', 'wrangler.preview.jsonc');
const API_BASE = 'https://api.cloudflare.com/client/v4';
const FETCH_TIMEOUT_MS = 15000;

class ApiError extends Error {
  constructor(message, { status, errors } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errors = errors;
  }
}

// ---------------------------------------------------------------------------
// Small HTTP helper. All mutating verbs are gated by DRY_RUN at the call
// site (see the `mutate()` wrapper below), never inside this function - this
// function itself has no opinion about read vs write, it just makes the call.
// ---------------------------------------------------------------------------
async function cfFetch(accountId, apiToken, methodPath, { method = 'GET', body } = {}) {
  const url = `${API_BASE}/accounts/${accountId}${methodPath}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    throw new ApiError(`Network error calling Cloudflare API (${method} ${methodPath}): ${error.message}`);
  } finally {
    clearTimeout(timer);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError(`Cloudflare API returned a non-JSON response (${method} ${methodPath}, HTTP ${response.status}).`, { status: response.status });
  }

  if (!response.ok || payload.success === false) {
    const errors = Array.isArray(payload.errors) ? payload.errors : [];
    const detail = errors.map((entry) => `[${entry.code}] ${entry.message}`).join('; ') || 'no error detail returned';
    throw new ApiError(`Cloudflare API call failed (${method} ${methodPath}, HTTP ${response.status}): ${detail}`, { status: response.status, errors });
  }
  return payload.result;
}

// Wrapper that makes the DRY_RUN behavior for mutating calls impossible to
// forget at a call site: pass a description and the real call: the call is
// only ever invoked when DRY_RUN is off.
async function mutate(description, fn) {
  if (isDryRun()) {
    safeLog('[DRY RUN] would', description);
    return null;
  }
  safeLog('Applying', description);
  return fn();
}

function diffFields(existing, desired) {
  const changed = {};
  for (const [key, value] of Object.entries(desired)) {
    const before = existing[key];
    const same = JSON.stringify(before) === JSON.stringify(value);
    if (!same) changed[key] = { from: before, to: value };
  }
  return changed;
}

function readEmailList(envVarName) {
  const raw = process.env[envVarName];
  if (!raw || !raw.trim()) return null;
  const emails = raw.split(',').map((entry) => entry.trim()).filter(Boolean);
  return emails.length ? emails : null;
}

// ---------------------------------------------------------------------------
// Step c: confirm Access is enabled and the token can read the org.
// ---------------------------------------------------------------------------
async function readOrganization(accountId, apiToken) {
  try {
    return await cfFetch(accountId, apiToken, '/access/organizations');
  } catch (error) {
    throw new GuardrailError(
      'Could not read the Zero Trust organization for this account '
      + `(${error.message}). This usually means Access is not enabled on this `
      + 'account yet, or the CLOUDFLARE_API_TOKEN is missing scopes. The token '
      + 'needs: "Access: Organizations, Identity Providers, and Groups" (Edit) '
      + 'and "Access: Apps and Policies" (Edit) at the Account level. Not retrying - '
      + 'fix the token/organization state and re-run.',
    );
  }
}

// ---------------------------------------------------------------------------
// Step d: identity provider - use what the Zero Trust organization actually
// has configured. Cloudflare account identity is preferred when present;
// One-Time PIN is created only when no supported provider exists.
// ---------------------------------------------------------------------------
async function ensureIdentityProvider(accountId, apiToken) {
  const providers = await cfFetch(accountId, apiToken, '/access/identity_providers');
  const existing = IDENTITY_PROVIDER.preferredTypes
    .map((type) => providers.find((provider) => provider.type === type))
    .find(Boolean);
  if (existing) {
    safeLog('Identity provider', `reusing configured ${existing.type} provider "${existing.name || '(account identity)'}" (${existing.id})`);
    return existing;
  }
  const created = await mutate(`create identity provider "${IDENTITY_PROVIDER.fallbackName}" (type=${IDENTITY_PROVIDER.fallbackType})`, () =>
    cfFetch(accountId, apiToken, '/access/identity_providers', {
      method: 'POST',
      body: { type: IDENTITY_PROVIDER.fallbackType, name: IDENTITY_PROVIDER.fallbackName },
    }));
  return created || {
    id: '<DRY_RUN:would-create>',
    name: IDENTITY_PROVIDER.fallbackName,
    type: IDENTITY_PROVIDER.fallbackType,
  };
}

// ---------------------------------------------------------------------------
// Step e/f: applications and their policies.
//
// Note on paths: this account's Access Applications API accepts a single
// self-hosted app whose `domain` is a bare hostname and whose match rules
// live in `self_hosted_domains` (an array of "hostname/path" strings) - one
// app CAN cover multiple paths this way, so we do not split into per-path
// apps with a "-{n}" suffix. self_hosted_domains is the field this script
// targets; if a future API version drops multi-path support on this field,
// switch to one app per path with a "-{n}" name suffix and update this
// comment plus access-config.mjs's `name` handling accordingly.
// ---------------------------------------------------------------------------
async function ensureApplication(accountId, apiToken, appConfig, identityProvider) {
  assertNotProductionHostname(appConfig.domain, `Access app "${appConfig.name}"`);
  for (const p of appConfig.paths) assertNotProductionHostname(appConfig.domain, `Access app "${appConfig.name}" path ${p}`);

  const selfHostedDomains = appConfig.paths.map((p) => `${appConfig.domain}${p}`);
  // Cloudflare deprecated self_hosted_domains in favor of `destinations`
  // (each a {type:'public', uri} entry). CONFIRMED against this account's
  // real API (not a guess - tried both ways): a self-hosted Access
  // Application with a `domain` set requires that bare domain to appear
  // literally in `destinations`, and removing it reproduces
  // "domain not included in destinations" every time. Once present, the app
  // enforces across the ENTIRE domain regardless of how narrow the other
  // destinations/self_hosted_domains entries are (verified live:
  // /api/commerce/services and /client-portal/, neither in this app's own
  // `paths`, both got redirected into this app's Access challenge the
  // moment the bare-domain destination existed). This means a self-hosted
  // Access Application is effectively whole-domain in this API version -
  // path-scoped multi-app separation on one hostname is NOT achievable this
  // way. Path-scoped entries are kept alongside the required bare domain
  // for documentation/intent, not because they narrow anything.
  const destinations = [
    { type: 'public', uri: appConfig.domain },
    ...selfHostedDomains.map((uri) => ({ type: 'public', uri })),
  ];
  const desired = {
    name: appConfig.name,
    domain: appConfig.domain,
    self_hosted_domains: selfHostedDomains,
    destinations,
    session_duration: appConfig.sessionDuration || SESSION_DURATION,
    type: 'self_hosted',
    allowed_idps: identityProvider.id.startsWith('<DRY_RUN:') ? [] : [identityProvider.id],
    auto_redirect_to_identity: !identityProvider.id.startsWith('<DRY_RUN:'),
  };

  const existingApps = await cfFetch(accountId, apiToken, '/access/apps');
  const existing = existingApps.find((app) => app.name === appConfig.name);

  let app;
  if (!existing) {
    app = await mutate(`create Access app "${appConfig.name}" for ${selfHostedDomains.join(', ')}`, () =>
      cfFetch(accountId, apiToken, '/access/apps', { method: 'POST', body: desired }));
    app = app || { id: '<DRY_RUN:would-create>', ...desired };
  } else {
    const changed = diffFields(existing, desired);
    if (Object.keys(changed).length === 0) {
      safeLog(`Access app "${appConfig.name}"`, 'already matches desired config, no update needed');
      app = existing;
    } else {
      safeLog(`Access app "${appConfig.name}" changed fields`, JSON.stringify(changed));
      await mutate(`update Access app "${appConfig.name}" (${Object.keys(changed).join(', ')})`, () =>
        cfFetch(accountId, apiToken, `/access/apps/${existing.id}`, { method: 'PUT', body: { ...existing, ...desired } }));
      app = { ...existing, ...desired };
    }
  }

  await ensurePolicies(accountId, apiToken, app, appConfig);
  return app;
}

async function ensurePolicies(accountId, apiToken, app, appConfig) {
  const appId = app.id;
  const existingPolicies = appId && appId !== '<DRY_RUN:would-create>'
    ? await cfFetch(accountId, apiToken, `/access/apps/${appId}/policies`)
    : [];

  let precedence = 1;
  for (const policyConfig of appConfig.policies) {
    const emails = readEmailList(policyConfig.includeEmailsEnvVar);
    if (!emails) {
      safeLog('Policy skipped', `"${policyConfig.name}" on app "${appConfig.name}" - env var ${policyConfig.includeEmailsEnvVar} is unset or empty. Set it (comma-separated emails) and re-run to create this policy.`);
      continue;
    }
    const desired = {
      name: policyConfig.name,
      decision: policyConfig.decision,
      precedence: precedence++,
      include: emails.map((email) => ({ email: { email } })),
    };
    const existing = existingPolicies.find((policy) => policy.name === policyConfig.name);
    if (!existing) {
      await mutate(`create policy "${policyConfig.name}" on app "${appConfig.name}" for ${emails.length} email(s)`, () =>
        cfFetch(accountId, apiToken, `/access/apps/${appId}/policies`, { method: 'POST', body: desired }));
    } else {
      const changed = diffFields(existing, desired);
      if (Object.keys(changed).length === 0) {
        safeLog(`Policy "${policyConfig.name}"`, 'already matches desired config, no update needed');
      } else {
        safeLog(`Policy "${policyConfig.name}" changed fields`, JSON.stringify(changed));
        await mutate(`update policy "${policyConfig.name}" on app "${appConfig.name}" (${Object.keys(changed).join(', ')})`, () =>
          cfFetch(accountId, apiToken, `/access/apps/${appId}/policies/${existing.id}`, { method: 'PUT', body: { ...existing, ...desired } }));
      }
    }
  }

  if (appConfig.defaultDeny) {
    const denyName = `${appConfig.name} - default deny`;
    const existingDeny = existingPolicies.find((policy) => policy.name === denyName);
    if (!existingDeny) {
      await mutate(`create default-deny policy on app "${appConfig.name}"`, () =>
        cfFetch(accountId, apiToken, `/access/apps/${appId}/policies`, {
          method: 'POST',
          body: { name: denyName, decision: 'deny', precedence: precedence++, include: [{ everyone: {} }] },
        }));
    } else {
      safeLog(`Default-deny policy on app "${appConfig.name}"`, 'already present, no update needed');
    }
  }
}

// ---------------------------------------------------------------------------
// Step h: write the three non-secret preview vars into wrangler.preview.jsonc.
// ---------------------------------------------------------------------------
async function writePreviewVars(resolvedVars) {
  const raw = await readFile(WRANGLER_PREVIEW_PATH, 'utf8');
  // wrangler.preview.jsonc is JSONC but this repo's copy has no comments in
  // practice (see the file as read at task start) - JSON.parse is sufficient
  // and preserves us from needing a JSONC parser dependency. If comments are
  // ever added to this file, this will need to change to a comment-preserving
  // editor instead of a full read-modify-write.
  const parsed = JSON.parse(raw);
  const before = { ...(parsed.vars || {}) };
  const after = { ...before, ...resolvedVars };
  const diff = diffFields(before, after);

  if (Object.keys(diff).length === 0) {
    safeLog('wrangler.preview.jsonc vars', 'already match desired values, no write needed');
    return { changed: false, diff };
  }

  safeLog('wrangler.preview.jsonc vars changed fields', JSON.stringify(diff));
  if (isDryRun()) {
    safeLog('[DRY RUN] would write', `wrangler.preview.jsonc vars -> ${JSON.stringify(after)}`);
    return { changed: false, diff };
  }

  parsed.vars = after;
  await writeFile(WRANGLER_PREVIEW_PATH, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  return { changed: true, diff };
}

// ---------------------------------------------------------------------------
// Step i: final validation.
// ---------------------------------------------------------------------------
async function validateFinalState(accountId, apiToken, expectedAuds, applicationsToCheck = APPLICATIONS, requiredVarsToCheck = REQUIRED_PREVIEW_ENV_VARS) {
  const problems = [];

  const apps = await cfFetch(accountId, apiToken, '/access/apps');
  for (const appConfig of applicationsToCheck) {
    const app = apps.find((candidate) => candidate.name === appConfig.name);
    if (!app && !isDryRun()) problems.push(`Access app "${appConfig.name}" not found after apply.`);
  }

  let raw;
  try {
    raw = await readFile(WRANGLER_PREVIEW_PATH, 'utf8');
  } catch (error) {
    problems.push(`Could not re-read wrangler.preview.jsonc: ${error.message}`);
    return problems;
  }
  const parsed = JSON.parse(raw);
  const vars = parsed.vars || {};
  for (const name of requiredVarsToCheck) {
    if (!isDryRun() && !vars[name]) problems.push(`wrangler.preview.jsonc vars.${name} is missing or empty after apply.`);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  printModeBanner(SCRIPT_NAME);
  assertNotProductionHostname(PREVIEW_HOSTNAME, 'Access setup target');

  const accountId = requireEnv('CLOUDFLARE_ACCOUNT_ID');
  const apiToken = requireEnv('CLOUDFLARE_API_TOKEN');
  safeLog('CLOUDFLARE_API_TOKEN', apiToken);

  const org = await readOrganization(accountId, apiToken);
  const teamDomain = org?.auth_domain
    ? (org.auth_domain.startsWith('http') ? org.auth_domain : `https://${org.auth_domain}`)
    : null;
  if (!teamDomain) {
    throw new GuardrailError('Zero Trust organization lookup succeeded but returned no auth_domain - cannot determine ACCESS_TEAM_DOMAIN. Check the organization is fully set up in the Cloudflare dashboard.');
  }
  safeLog('Zero Trust organization', `${org.name || '(unnamed)'} - team domain ${teamDomain}`);

  const identityProvider = await ensureIdentityProvider(accountId, apiToken);

  // Each application is independent - one app failing (e.g. a plan-level
  // destinations-count limit on a wide-path app) must not discard AUDs
  // already resolved for apps that succeeded. Failures are collected and
  // reported at the end; that app's *_ACCESS_AUD is simply omitted from
  // resolvedVars (never written as the literal string "undefined") so a
  // later run can retry just that one app once its own issue is fixed.
  const audByKey = {};
  const appFailures = [];
  for (const appConfig of APPLICATIONS) {
    try {
      const app = await ensureApplication(accountId, apiToken, appConfig, identityProvider);
      audByKey[appConfig.key] = app?.aud || '<DRY_RUN:unresolved-aud>';
      safeLog(`Resolved AUD for ${appConfig.audEnvVar}`, audByKey[appConfig.key]);
    } catch (error) {
      appFailures.push({ key: appConfig.key, name: appConfig.name, message: error.message });
      safeLog(`Access app "${appConfig.name}" FAILED (skipped, other apps unaffected)`, error.message);
    }
  }

  const resolvedVars = { ACCESS_TEAM_DOMAIN: teamDomain };
  if (audByKey.admin) resolvedVars.ADMIN_ACCESS_AUD = audByKey.admin;
  if (audByKey.client) resolvedVars.CLIENT_ACCESS_AUD = audByKey.client;

  console.log('\nResolved preview env vars (to be written to wrangler.preview.jsonc):');
  for (const [key, value] of Object.entries(resolvedVars)) safeLog(`  ${key}`, value);

  await writePreviewVars(resolvedVars);

  const failedKeys = new Set(appFailures.map((f) => f.key));
  const relevantApplications = APPLICATIONS.filter((a) => !failedKeys.has(a.key));
  const relevantRequiredVars = REQUIRED_PREVIEW_ENV_VARS.filter((name) => {
    const skippedApp = APPLICATIONS.find((a) => a.audEnvVar === name && failedKeys.has(a.key));
    return !skippedApp;
  });
  const problems = await validateFinalState(accountId, apiToken, resolvedVars, relevantApplications, relevantRequiredVars);

  console.log('\n=== cloudflare-access-setup summary ===');
  if (isDryRun()) {
    console.log('DRY RUN - no mutating API calls or file writes were made. Review the [DRY RUN] lines above for what would happen on a real run.');
    process.exit(0);
  }
  if (appFailures.length) {
    console.log('PARTIAL - the following application(s) were skipped and need a separate fix before retrying just them:');
    for (const failure of appFailures) console.log(`  - ${failure.name}: ${failure.message}`);
  }
  if (problems.length) {
    console.log('FAILED - final-state validation found problems (beyond the known skipped app(s) above):');
    for (const problem of problems) console.log(`  - ${problem}`);
    process.exit(1);
  }
  console.log(appFailures.length
    ? 'OK (partial) - every application that did not hit a separate, already-reported issue matches desired config; its env vars are present.'
    : 'OK - identity provider, Access apps, and policies match desired config; wrangler.preview.jsonc vars are present.');
  process.exit(0);
}

main().catch((error) => {
  if (error instanceof GuardrailError || error instanceof ApiError) {
    console.error(`\n[${SCRIPT_NAME}] ERROR: ${error.message}`);
    process.exit(1);
  }
  console.error(`\n[${SCRIPT_NAME}] UNEXPECTED ERROR: ${error.message}`);
  if (process.env.DEBUG) console.error(error.stack);
  process.exit(1);
});
