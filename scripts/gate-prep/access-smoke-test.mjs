#!/usr/bin/env node
// Read-only end-to-end smoke test for Cloudflare Access, run AFTER
// cloudflare-access-setup.mjs has configured Access and the preview site is
// deployed. Makes real HTTP requests to the live preview hostname - no
// local D1 access, no mutation, no data created.
//
// Always runs (no credentials needed):
//   - unauthenticated /admin/ is blocked by Access
//   - unauthenticated /api/ops/admin/summary is blocked by Access
//   - unauthenticated /client-portal/ is blocked by Access
//
// Runs only if provided (a human completes the OTP flow once and copies the
// resulting Access session cookie value):
//   - ADMIN_TEST_SESSION_TOKEN  -> authenticated admin request reaches the app
//   - CLIENT_TEST_SESSION_TOKEN -> authenticated client request reaches the app
//
// Usage:
//   node scripts/gate-prep/access-smoke-test.mjs
//   ADMIN_TEST_SESSION_TOKEN=... CLIENT_TEST_SESSION_TOKEN=... node scripts/gate-prep/access-smoke-test.mjs

import { printModeBanner, safeLog } from './lib/guardrails.mjs';
import { PREVIEW_HOSTNAME } from './config/access-config.mjs';

const SCRIPT_NAME = 'access-smoke-test';
const FETCH_TIMEOUT_MS = 10000;
const BASE_URL = `https://${PREVIEW_HOSTNAME}`;
// Cloudflare Access's own cookie name for a completed session.
const ACCESS_COOKIE_NAME = 'CF_Authorization';

const results = [];

function record(name, status, detail) {
  results.push({ name, status, detail });
  const marker = status === 'PASS' ? 'PASS' : status === 'SKIPPED' ? 'SKIP' : 'FAIL';
  console.log(`[${marker}] ${name}${detail ? ` - ${detail}` : ''}`);
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, redirect: 'manual', signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Access intercepts unauthenticated requests before the app ever runs, in
// one of two shapes depending on app type/config:
//   - a 302/303 redirect to <team-domain>/cdn-cgi/access/login/...
//   - a 403 whose body is Access's own login/denial HTML (contains
//     "cdn-cgi/access" or the Access branding), not the app's JSON error
// We check for Access's signature specifically so a bug in the app itself
// that happens to also return 403 doesn't get mistaken for Access working.
async function assertBlockedByAccess(pathname) {
  const url = `${BASE_URL}${pathname}`;
  let response;
  try {
    response = await fetchWithTimeout(url);
  } catch (error) {
    record(`unauthenticated ${pathname} blocked by Access`, 'FAIL', `request error: ${error.message}`);
    return;
  }

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location') || '';
    if (/cdn-cgi\/access\/login/i.test(location) || /\.cloudflareaccess\.com/i.test(location)) {
      record(`unauthenticated ${pathname} blocked by Access`, 'PASS', `redirected to Access login (${location})`);
      return;
    }
    record(`unauthenticated ${pathname} blocked by Access`, 'FAIL', `redirected, but not to Access login: ${location}`);
    return;
  }

  if (response.status === 403) {
    const body = await response.text().catch(() => '');
    if (/cdn-cgi\/access/i.test(body) || /cloudflare access/i.test(body) || /Access\b/.test(body)) {
      record(`unauthenticated ${pathname} blocked by Access`, 'PASS', 'HTTP 403 with Access denial page');
      return;
    }
    record(`unauthenticated ${pathname} blocked by Access`, 'FAIL', 'HTTP 403 but body does not look like Access\'s own denial page - may be the app\'s own error instead');
    return;
  }

  record(`unauthenticated ${pathname} blocked by Access`, 'FAIL', `expected a redirect to Access login or HTTP 403, got HTTP ${response.status}`);
}

// With a valid Access session cookie, the request should sail through Access
// and reach the app - i.e. we should see the app's own response (JSON for
// API routes, the app's HTML shell for page routes), not Access's login page.
async function assertReachesApp(pathname, cookieValue, label) {
  if (!cookieValue) {
    record(label, 'SKIPPED', `no test session token provided - set the relevant *_TEST_SESSION_TOKEN env var to enable this check`);
    return;
  }
  const url = `${BASE_URL}${pathname}`;
  let response;
  try {
    response = await fetchWithTimeout(url, { headers: { Cookie: `${ACCESS_COOKIE_NAME}=${cookieValue}` } });
  } catch (error) {
    record(label, 'FAIL', `request error: ${error.message}`);
    return;
  }

  if (response.status >= 300 && response.status < 400) {
    record(label, 'FAIL', `still redirected (HTTP ${response.status}) - session token likely invalid or expired`);
    return;
  }
  if (response.status === 403) {
    const body = await response.text().catch(() => '');
    if (/cdn-cgi\/access/i.test(body)) {
      record(label, 'FAIL', 'still blocked by Access (403 Access denial page) - session token likely invalid or expired');
      return;
    }
  }
  record(label, response.status < 500 ? 'PASS' : 'FAIL', `HTTP ${response.status} - reached the application`);
}

async function main() {
  printModeBanner(SCRIPT_NAME);
  safeLog('Target preview hostname', PREVIEW_HOSTNAME);
  console.log(`Base URL: ${BASE_URL}\n`);

  await assertBlockedByAccess('/admin/');
  await assertBlockedByAccess('/api/ops/admin/summary');
  await assertBlockedByAccess('/client-portal/');

  await assertReachesApp('/admin/', process.env.ADMIN_TEST_SESSION_TOKEN, 'authenticated admin request reaches the app (ADMIN_TEST_SESSION_TOKEN)');
  await assertReachesApp('/client-portal/', process.env.CLIENT_TEST_SESSION_TOKEN, 'authenticated client request reaches the app (CLIENT_TEST_SESSION_TOKEN)');

  const passed = results.filter((r) => r.status === 'PASS');
  const skipped = results.filter((r) => r.status === 'SKIPPED');
  const failed = results.filter((r) => r.status === 'FAIL');

  console.log('\n=== access-smoke-test summary ===');
  console.log(`CONFIGURED: Access apps for /admin/*, /api/ops/admin/*, /client-portal/* expected in place at ${PREVIEW_HOSTNAME} (see cloudflare-access-setup.mjs for provisioning).`);
  console.log(`TESTED: ${passed.length} check(s) passed, ${failed.length} failed, ${skipped.length} skipped.`);
  console.log('EVIDENCE:');
  for (const r of results) console.log(`  [${r.status}] ${r.name}${r.detail ? ` - ${r.detail}` : ''}`);
  console.log('REGRESSION CHECK: unauthenticated access to protected admin/client routes must always fail this suite\'s first three checks - a PASS there on a future run after any Access config change is required before deploying that change.');
  if (skipped.length) {
    console.log('REMAINING: authenticated-session checks were skipped where no test token was provided. Provide ADMIN_TEST_SESSION_TOKEN / CLIENT_TEST_SESSION_TOKEN (captured once by a human completing the email OTP flow and copying the CF_Authorization cookie) to close this gap.');
  }

  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error(`\n[${SCRIPT_NAME}] UNEXPECTED ERROR: ${error.message}`);
  if (process.env.DEBUG) console.error(error.stack);
  process.exit(1);
});
