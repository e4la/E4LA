#!/usr/bin/env node
// Idempotent Stripe Sandbox (test-mode only) provisioning for the E4LA
// Client Operations Products/Prices/Customer Portal configuration.
//
// This script only ever creates the Products, Prices, and Billing Portal
// Configuration described in scripts/gate-prep/config/stripe-plans-config.mjs
// (the single source of truth for what gets provisioned - nothing here
// hardcodes a duplicate plan definition). It does not touch D1, does not
// create a webhook endpoint (see step 6 below for why), and never accepts a
// live-mode Stripe key.
//
// Usage:
//   STRIPE_SECRET_KEY=sk_test_... [STRIPE_API_VERSION=2024-06-20] node scripts/gate-prep/stripe-sandbox-provision.mjs
//   DRY_RUN=1 STRIPE_SECRET_KEY=sk_test_... node scripts/gate-prep/stripe-sandbox-provision.mjs
//
// Exit code is 0 on full success or clean no-op, non-zero on any failure.

import {
  GuardrailError,
  assertNoLivemodeObject,
  assertTestModeStripeKey,
  isDryRun,
  optionalEnv,
  printModeBanner,
  requireEnv,
  safeLog,
} from './lib/guardrails.mjs';
import {
  CUSTOMER_PORTAL_CONFIGURATION,
  PLANS,
  REQUIRED_WEBHOOK_EVENTS,
} from './config/stripe-plans-config.mjs';
import { PREVIEW_HOSTNAME } from './config/access-config.mjs';

const SCRIPT_NAME = 'stripe-sandbox-provision';
export const STRIPE_API_BASE = 'https://api.stripe.com/v1';

// A stable, deliberate fallback API version so this script is runnable
// without extra ceremony. functions/_shared/stripe.js refuses to run at all
// without an explicit, Workbench-confirmed STRIPE_API_VERSION - this script
// is more lenient (it only reads/writes sandbox config objects, it never
// touches payment data), but still strongly prefers an explicit value.
const FALLBACK_STRIPE_API_VERSION = '2024-06-20';

// ---------------------------------------------------------------------------
// Low-level Stripe request helpers - mirrors the SAME request shape/auth
// pattern already used by functions/_shared/stripe.js (Bearer key,
// Stripe-Version header, application/x-www-form-urlencoded body with
// bracketed nested keys, Idempotency-Key on mutating calls, and rejecting
// any response with livemode:true). Duplicated here (rather than imported)
// because functions/_shared/stripe.js is Cloudflare Workers code that reads
// its key from a Workers `env` binding and throws Workers-flavored
// HttpError - this is a plain Node CLI script, so the shape is replicated,
// not the module itself.
// ---------------------------------------------------------------------------

export function encodeParameters(value, prefix = '', output = new URLSearchParams()) {
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || item === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(item)) {
      item.forEach((entry, index) => {
        if (typeof entry === 'object') encodeParameters(entry, `${name}[${index}]`, output);
        else output.append(`${name}[${index}]`, String(entry));
      });
    } else if (typeof item === 'object') {
      encodeParameters(item, name, output);
    } else {
      output.append(name, String(item));
    }
  }
  return output;
}

export async function stripeRequest({ secretKey, apiVersion, method, path, params = null, idempotencyKey = null }) {
  const headers = {
    Authorization: `Bearer ${secretKey}`,
    'Stripe-Version': apiVersion,
  };
  let body;
  if (params) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = encodeParameters(params);
  }
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const response = await fetch(`${STRIPE_API_BASE}${path}`, { method, headers, body });
  const payload = await response.json();
  if (!response.ok) {
    const message = payload?.error?.message || 'Stripe could not complete the request.';
    throw new Error(`Stripe ${method} ${path} failed: ${message}`);
  }
  return payload;
}

// GET-list pagination helper. Deliberately uses the plain List endpoints
// (not the Search API) for existence checks: Stripe's Search API has an
// eventual-consistency indexing lag of up to several seconds after an
// object is created, which would make a rerun shortly after a first
// provisioning run see a false "not found" and create a duplicate Product.
// List endpoints are read-your-writes consistent, which is what an
// idempotent provisioning script needs.
export async function listAll({ secretKey, apiVersion, path, params = {} }) {
  const results = [];
  let startingAfter;
  for (;;) {
    const query = new URLSearchParams({ ...params, limit: '100' });
    if (startingAfter) query.set('starting_after', startingAfter);
    const page = await stripeRequest({
      secretKey, apiVersion, method: 'GET', path: `${path}?${query.toString()}`,
    });
    for (const item of page.data || []) {
      assertNoLivemodeObject(item, `${SCRIPT_NAME}: listing ${path}`);
      results.push(item);
    }
    if (!page.has_more || !page.data?.length) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
  return results;
}

export async function findExistingProduct({ secretKey, apiVersion, planCode }) {
  const products = await listAll({ secretKey, apiVersion, path: '/products' });
  return products.find((product) => product.metadata?.e4la_plan_code === planCode) || null;
}

export async function findExistingPrice({ secretKey, apiVersion, planCode, priceNickname }) {
  const prices = await listAll({ secretKey, apiVersion, path: '/prices' });
  return prices.find((price) => price.metadata?.e4la_plan_code === planCode && price.nickname === priceNickname) || null;
}

export async function findExistingPortalConfiguration({ secretKey, apiVersion }) {
  const configurations = await listAll({ secretKey, apiVersion, path: '/billing_portal/configurations' });
  return configurations.find((config) => config.metadata?.e4la_portal_config === 'client_operations_preview' && config.active !== false) || null;
}

// ---------------------------------------------------------------------------
// Provisioning
// ---------------------------------------------------------------------------

async function ensureProductAndPrice({ secretKey, apiVersion, plan }) {
  const context = `${SCRIPT_NAME}: plan "${plan.code}"`;
  let product = await findExistingProduct({ secretKey, apiVersion, planCode: plan.code });
  if (product) {
    safeLog(`[${SCRIPT_NAME}] product exists`, `${plan.code} -> ${product.id}`);
  } else if (isDryRun()) {
    safeLog(`[${SCRIPT_NAME}] [DRY RUN] would create product`, JSON.stringify({
      name: plan.productName, metadata: { e4la_plan_code: plan.code },
    }));
    product = { id: `[dry-run-product:${plan.code}]`, __dryRun: true };
  } else {
    product = await stripeRequest({
      secretKey, apiVersion, method: 'POST', path: '/products',
      params: { name: plan.productName, metadata: { e4la_plan_code: plan.code } },
      idempotencyKey: `provision:product:${plan.code}`,
    });
    assertNoLivemodeObject(product, context);
    safeLog(`[${SCRIPT_NAME}] created product`, `${plan.code} -> ${product.id}`);
  }

  let price = null;
  if (!product.__dryRun) {
    price = await findExistingPrice({ secretKey, apiVersion, planCode: plan.code, priceNickname: plan.priceNickname });
  }
  if (price) {
    safeLog(`[${SCRIPT_NAME}] price exists`, `${plan.code} -> ${price.id}`);
  } else if (isDryRun() || product.__dryRun) {
    safeLog(`[${SCRIPT_NAME}] [DRY RUN] would create price`, JSON.stringify({
      product: product.id, unit_amount: plan.amount, currency: plan.currency,
      nickname: plan.priceNickname, metadata: { e4la_plan_code: plan.code },
    }));
    price = { id: `[dry-run-price:${plan.code}]`, __dryRun: true };
  } else {
    price = await stripeRequest({
      secretKey, apiVersion, method: 'POST', path: '/prices',
      params: {
        product: product.id,
        unit_amount: plan.amount,
        currency: plan.currency,
        nickname: plan.priceNickname,
        metadata: { e4la_plan_code: plan.code },
      },
      idempotencyKey: `provision:price:${plan.code}`,
    });
    assertNoLivemodeObject(price, context);
    safeLog(`[${SCRIPT_NAME}] created price`, `${plan.code} -> ${price.id}`);
  }

  return { product, price };
}

async function ensurePortalConfiguration({ secretKey, apiVersion }) {
  const context = `${SCRIPT_NAME}: portal configuration`;
  const existing = await findExistingPortalConfiguration({ secretKey, apiVersion });
  const desiredParams = {
    metadata: { e4la_portal_config: 'client_operations_preview' },
    features: CUSTOMER_PORTAL_CONFIGURATION.features,
  };

  if (existing) {
    safeLog(`[${SCRIPT_NAME}] portal configuration exists`, existing.id);
    if (isDryRun()) {
      safeLog(`[${SCRIPT_NAME}] [DRY RUN] would update portal configuration`, JSON.stringify({ id: existing.id, ...desiredParams }));
      return existing;
    }
    const updated = await stripeRequest({
      secretKey, apiVersion, method: 'POST', path: `/billing_portal/configurations/${existing.id}`,
      params: desiredParams,
    });
    assertNoLivemodeObject(updated, context);
    safeLog(`[${SCRIPT_NAME}] updated portal configuration`, updated.id);
    return updated;
  }

  if (isDryRun()) {
    safeLog(`[${SCRIPT_NAME}] [DRY RUN] would create portal configuration`, JSON.stringify(desiredParams));
    return { id: '[dry-run-portal-configuration]', __dryRun: true };
  }

  // Stripe requires business_profile.headline (or an existing default
  // configuration with a business profile already set on the account) the
  // first time a Billing Portal configuration is ever created for an
  // account. This script does not invent E4LA business-profile copy - if
  // Stripe rejects creation for that reason, the error message below will
  // say so explicitly, and STRIPE_PORTAL_HEADLINE / STRIPE_PORTAL_PRIVACY_URL
  // / STRIPE_PORTAL_TOS_URL can be set to supply it.
  const businessProfile = buildOptionalBusinessProfile();
  const created = await stripeRequest({
    secretKey, apiVersion, method: 'POST', path: '/billing_portal/configurations',
    params: { ...desiredParams, ...(businessProfile ? { business_profile: businessProfile } : {}) },
    idempotencyKey: 'provision:portal-configuration:client_operations_preview',
  });
  assertNoLivemodeObject(created, context);
  safeLog(`[${SCRIPT_NAME}] created portal configuration`, created.id);
  return created;
}

function buildOptionalBusinessProfile() {
  const headline = optionalEnv('STRIPE_PORTAL_HEADLINE');
  const privacyUrl = optionalEnv('STRIPE_PORTAL_PRIVACY_URL');
  const termsUrl = optionalEnv('STRIPE_PORTAL_TOS_URL');
  if (!headline && !privacyUrl && !termsUrl) return null;
  const profile = {};
  if (headline) profile.headline = headline;
  if (privacyUrl) profile.privacy_policy_url = privacyUrl;
  if (termsUrl) profile.terms_of_service_url = termsUrl;
  return profile;
}

function printWebhookInstructions() {
  console.log('');
  console.log(`[${SCRIPT_NAME}] Webhook endpoint - documentation only, not automated`);
  console.log('  Stripe rejects webhook endpoint creation against a URL it cannot reach, and');
  console.log('  the preview deployment is not guaranteed to be reachable when this script');
  console.log('  runs. This step prints what a human (or a later, deploy-time script) needs');
  console.log('  to configure by hand in the Stripe Dashboard or via the API once the preview');
  console.log('  is live:');
  console.log('');
  console.log(`    Endpoint URL: https://${PREVIEW_HOSTNAME}/api/stripe/webhook`);
  console.log('    Events to enable (exactly these, from stripe-plans-config.mjs REQUIRED_WEBHOOK_EVENTS):');
  for (const event of REQUIRED_WEBHOOK_EVENTS) console.log(`      - ${event}`);
  console.log('    After creating it, set STRIPE_WEBHOOK_SECRET to the endpoint signing secret (whsec_...).');
}

function printResultSummary({ apiVersion, planResults, portalConfiguration }) {
  console.log('');
  console.log(`[${SCRIPT_NAME}] Result summary`);
  console.log(`  STRIPE_API_VERSION=${apiVersion}`);
  console.log(`  STRIPE_PORTAL_CONFIGURATION_ID=${portalConfiguration.id}`);
  console.log('');
  console.log('  Plan code -> Price ID mapping:');
  console.log('  (These are NOT extra top-level env vars. functions/_shared/stripe.js reads');
  console.log('   plan.stripe_initial_price_id / plan.stripe_remaining_price_id off the');
  console.log('   payment_plans D1 row for each plan - createCheckoutSession() builds its');
  console.log('   Checkout line item from plan.stripe_initial_price_id, and');
  console.log('   createRemainingInstallmentSchedule() builds the schedule phase from');
  console.log('   plan.stripe_remaining_price_id. Write these into each payment_plans row');
  console.log('   (keyed by plan_code, scoped to the relevant agreement_version_id), e.g.:');
  console.log('');
  for (const { plan, product, price } of planResults) {
    const remainingPriceId = plan.remainingSchedule ? price.id : null;
    console.log(`  ${plan.code}:`);
    console.log(`    product=${product.id}`);
    console.log(`    price=${price.id}`);
    if (plan.remainingSchedule) {
      console.log(`    (reused for the remaining-installment schedule phase - same amount:`);
      console.log(`     checkout amount ${plan.amount} === remainingSchedule.amount ${plan.remainingSchedule.amount})`);
    }
    console.log(`    UPDATE payment_plans SET stripe_initial_price_id = '${price.id}',`);
    console.log(`      stripe_remaining_price_id = ${remainingPriceId ? `'${remainingPriceId}'` : 'NULL'}`);
    console.log(`      WHERE plan_code = '${plan.code}' AND agreement_version_id = '<agreement_version_id>';`);
    console.log('');
  }
}

export async function runProvisioning() {
  printModeBanner(SCRIPT_NAME);

  // Guardrail check MUST run before anything else - before DRY_RUN is even
  // consulted, and before any network call (not even a GET) is made.
  let secretKey;
  try {
    secretKey = requireEnv('STRIPE_SECRET_KEY');
    assertTestModeStripeKey(secretKey, SCRIPT_NAME);
  } catch (error) {
    if (error instanceof GuardrailError) {
      console.error(`[${SCRIPT_NAME}] REFUSING TO PROCEED: ${error.message}`);
      return 1;
    }
    throw error;
  }

  const apiVersion = optionalEnv('STRIPE_API_VERSION', FALLBACK_STRIPE_API_VERSION);
  if (apiVersion === FALLBACK_STRIPE_API_VERSION && !optionalEnv('STRIPE_API_VERSION')) {
    safeLog(`[${SCRIPT_NAME}] STRIPE_API_VERSION not set, using fallback`, apiVersion);
    console.log(`  Confirm the intended sandbox API version in Stripe Workbench and set`);
    console.log(`  STRIPE_API_VERSION explicitly before treating this run as final.`);
  }

  try {
    const planResults = [];
    for (const plan of PLANS) {
      const { product, price } = await ensureProductAndPrice({ secretKey, apiVersion, plan });
      planResults.push({ plan, product, price });
    }

    const portalConfiguration = await ensurePortalConfiguration({ secretKey, apiVersion });

    printWebhookInstructions();
    printResultSummary({ apiVersion, planResults, portalConfiguration });

    console.log('');
    console.log(`[${SCRIPT_NAME}] DONE${isDryRun() ? ' (dry run - nothing was created or modified)' : ''}.`);
    return 0;
  } catch (error) {
    console.error(`[${SCRIPT_NAME}] FAILED: ${error.message || error}`);
    return 1;
  }
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  runProvisioning().then((code) => process.exit(code));
}
