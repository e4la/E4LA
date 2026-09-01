// Shared safety guardrails for every external-gate preparation script under
// scripts/gate-prep/. Import from here rather than re-implementing checks -
// these are the one place "fail closed" logic lives, so a fix here fixes it
// everywhere.

export class GuardrailError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GuardrailError';
  }
}

export function isDryRun() {
  return process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
}

export function isPreviewOnly() {
  // Default true. Only an explicit, deliberate PREVIEW_ONLY=0 disables it, and
  // even then individual scripts still refuse anything that looks like a
  // production identifier (see assertNotProduction/assertPreviewHostname).
  return process.env.PREVIEW_ONLY !== '0' && process.env.PREVIEW_ONLY !== 'false';
}

export function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new GuardrailError(`Missing required environment variable: ${name}. Set it in your shell or a local .env this script loads explicitly - never hardcode it.`);
  return value;
}

export function optionalEnv(name, fallback = undefined) {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

// Redacts anything that looks like a secret before it is ever allowed near a
// log line. Call this on every value before printing, even ones you believe
// are already safe - defense in depth, not a judgment call per call site.
export function redact(value) {
  if (value === undefined || value === null) return value;
  const str = String(value);
  if (/^(sk_|rk_|whsec_)/.test(str)) return '[redacted:stripe-secret]';
  if (/^Bearer\s/i.test(str)) return '[redacted:bearer-token]';
  if (str.length > 20 && /^[A-Za-z0-9_-]+$/.test(str)) return `${str.slice(0, 4)}…[redacted:${str.length} chars]`;
  return str;
}

export function safeLog(label, value) {
  // eslint-disable-next-line no-console
  console.log(`${label}: ${redact(value)}`);
}

const PRODUCTION_HOST_PATTERNS = [/(^|\.)e4la\.org$/i];
const PRODUCTION_ID_ENV_DENYLIST = ['CLOUDFLARE_PRODUCTION_ZONE_ID', 'PRODUCTION_D1_DATABASE_ID', 'PRODUCTION_ACCESS_APP_ID'];

export function assertNotProductionHostname(hostname, context = 'operation') {
  if (!hostname) throw new GuardrailError(`${context}: no hostname provided - refusing to proceed without an explicit target.`);
  if (PRODUCTION_HOST_PATTERNS.some((pattern) => pattern.test(hostname))) {
    throw new GuardrailError(`${context}: hostname "${hostname}" matches a production pattern. This tool never targets production without PRODUCTION_ACTION_CONFIRMED=I-UNDERSTAND set explicitly for this single invocation, and even then only for operations that support it.`);
  }
}

export function assertProductionActionExplicitlyConfirmed(context) {
  if (process.env.PRODUCTION_ACTION_CONFIRMED !== 'I-UNDERSTAND') {
    throw new GuardrailError(`${context}: refusing - this would touch production and PRODUCTION_ACTION_CONFIRMED=I-UNDERSTAND was not set for this invocation.`);
  }
}

export function assertTestModeStripeKey(key, context = 'Stripe operation') {
  if (!key) throw new GuardrailError(`${context}: no Stripe key provided.`);
  if (!/^(sk|rk)_test_/.test(key)) {
    throw new GuardrailError(`${context}: refusing - key does not look like a Stripe *test-mode* secret/restricted key (expected sk_test_ or rk_test_ prefix). Live keys are never accepted by this tooling.`);
  }
}

export function assertNoLivemodeObject(object, context = 'Stripe object') {
  if (object && object.livemode === true) {
    throw new GuardrailError(`${context}: refusing - object has livemode=true. This tooling only operates on Stripe test-mode data.`);
  }
}

export function assertPreviewDatabaseIdentity(databaseName, expectedPreviewName) {
  if (databaseName !== expectedPreviewName) {
    throw new GuardrailError(`Refusing: expected the preview database "${expectedPreviewName}" but got "${databaseName}". This tool never applies migrations to an unconfirmed database identity.`);
  }
}

export function assertAllowlistedRecipient(email, allowlist) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!allowlist.map((entry) => entry.toLowerCase()).includes(normalized)) {
    throw new GuardrailError(`Refusing to send to "${email}" - not on the explicit preview recipient allowlist. Add it to RESEND_PREVIEW_ALLOWLIST if this is intentional and genuinely a fictional/controlled test address.`);
  }
}

// A single line every gate-prep script should print at the very top of its
// output, so a human skimming logs can see at a glance which mode ran.
export function printModeBanner(scriptName) {
  safeLog(`[${scriptName}] DRY_RUN`, isDryRun());
  safeLog(`[${scriptName}] PREVIEW_ONLY`, isPreviewOnly());
}
