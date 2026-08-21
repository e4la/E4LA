import { HttpError } from './ops-security.js';

const ENVIRONMENTS = new Set(['local', 'preview', 'production']);

export function readEnvironment(env) {
  return String(env.ENVIRONMENT || '').trim().toLowerCase();
}

export function validateEnvironmentConfiguration(env, options = {}) {
  const environment = readEnvironment(env);
  if (!ENVIRONMENTS.has(environment)) {
    throw new HttpError(503, 'environment_not_configured', 'This environment is not configured for Client Operations.');
  }

  const publicUrl = parsePublicUrl(env.PUBLIC_SITE_URL);
  if (environment !== 'local' && publicUrl.protocol !== 'https:') {
    throw new HttpError(503, 'environment_not_configured', 'The Client Operations site URL must use HTTPS.');
  }
  if (environment === 'preview' && /(^|\.)e4la\.org$/i.test(publicUrl.hostname)) {
    throw new HttpError(503, 'environment_mismatch', 'Preview cannot use the E4LA production hostname.');
  }
  if (environment === 'production' && !/(^|\.)e4la\.org$/i.test(publicUrl.hostname)) {
    throw new HttpError(503, 'environment_mismatch', 'Production must use an approved E4LA hostname.');
  }

  if (environment !== 'local' && !String(env.ENROLLMENT_SESSION_SECRET || '').trim()) {
    throw new HttpError(503, 'session_secret_not_configured', 'Secure session issuance is not configured.');
  }

  if (options.accessRequired) {
    for (const key of ['ACCESS_TEAM_DOMAIN', options.audienceVariable]) {
      if (!key || !String(env[key] || '').trim()) {
        throw new HttpError(503, 'identity_provider_not_configured', 'Server-backed identity is not configured for this surface.');
      }
    }
  }

  if (options.stripeRequired) validateStripeEnvironment(env, environment);
  return { environment, publicUrl };
}

export async function verifyDatabaseEnvironment(env) {
  if (!env.ENROLLMENT_DB) {
    throw new HttpError(503, 'database_not_configured', 'The Client Operations database is not configured.');
  }
  const expected = readEnvironment(env);
  if (expected === 'local') return;
  let row;
  try {
    row = await env.ENROLLMENT_DB.prepare(
      "SELECT setting_value FROM environment_settings WHERE setting_key = 'environment'",
    ).first();
  } catch {
    throw new HttpError(503, 'database_migration_required', 'The Client Operations database is not ready for this environment.');
  }
  if (!row || row.setting_value !== expected) {
    throw new HttpError(503, 'database_environment_mismatch', 'The Client Operations database binding does not match this environment.');
  }
}

function parsePublicUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/') throw new Error();
    return url;
  } catch {
    throw new HttpError(503, 'site_url_not_configured', 'The Client Operations site URL is not configured.');
  }
}

function validateStripeEnvironment(env, environment) {
  const key = String(env.STRIPE_SECRET_KEY || '');
  const webhook = String(env.STRIPE_WEBHOOK_SECRET || '');
  const apiVersion = String(env.STRIPE_API_VERSION || '');
  const portal = String(env.STRIPE_PORTAL_CONFIGURATION_ID || '');
  if (!key || !webhook || !apiVersion || !portal) {
    throw new HttpError(503, 'stripe_not_configured', 'Stripe sandbox configuration is incomplete.');
  }
  if (environment === 'preview' && !key.startsWith('sk_test_')) {
    throw new HttpError(503, 'stripe_environment_mismatch', 'Preview accepts Stripe test credentials only.');
  }
  if (environment === 'production' && key.startsWith('sk_test_')) {
    throw new HttpError(503, 'stripe_environment_mismatch', 'Production cannot use Stripe test credentials.');
  }
  if (!webhook.startsWith('whsec_') || !portal.startsWith('bpc_')) {
    throw new HttpError(503, 'stripe_not_configured', 'Stripe webhook or portal configuration is invalid.');
  }
}
