#!/usr/bin/env node
// Automated scenario runner meant to execute against a real Stripe
// test-mode account, once scripts/gate-prep/stripe-sandbox-provision.mjs has
// provisioned it. Uses Stripe's documented test-mode payment method tokens
// (pm_card_visa, pm_card_chargeDeclined, pm_card_authenticationRequired -
// https://docs.stripe.com/testing) directly against the real Stripe API.
// No browser, no real card entry, no card data ever touches this script.
//
// This suite deliberately does NOT duplicate tests/phase-d-stripe.test.mjs,
// which already covers this app's own webhook/schedule/idempotency logic
// against a *mocked* fetch. This suite instead checks that the real Stripe
// test-mode API actually behaves the way that mocked suite assumes (e.g.
// that an invalid subscription schedule payload really is rejected, that
// pm_card_chargeDeclined really does fail, etc). Anything that fundamentally
// requires this app's own webhook receiver or session endpoints to be live
// and reachable is logged as SKIPPED rather than fragile-simulated - see the
// SCENARIOS table below for exactly which is which.
//
// Usage:
//   STRIPE_SECRET_KEY=sk_test_... [STRIPE_API_VERSION=2024-06-20] node scripts/gate-prep/stripe-validation-suite.mjs
//
// DRY_RUN is not meaningful here (this script only ever runs against a real
// Stripe test-mode account and every scenario is itself already test-mode
// data) but the test-mode guardrail still runs first, exactly like the
// provisioning script, and still refuses to make any call at all without it.
//
// Exit code is 0 if every RAN scenario passed, non-zero if any RAN scenario
// failed. SKIPPED scenarios never affect the exit code.

import {
  GuardrailError,
  assertNoLivemodeObject,
  assertTestModeStripeKey,
  optionalEnv,
  printModeBanner,
  requireEnv,
  safeLog,
} from './lib/guardrails.mjs';
import { PLANS, PROGRAM_FEE_TOTAL } from './config/stripe-plans-config.mjs';
import {
  findExistingPrice,
  stripeRequest,
} from './stripe-sandbox-provision.mjs';

const SCRIPT_NAME = 'stripe-validation-suite';
const FALLBACK_STRIPE_API_VERSION = '2024-06-20';

// Stripe's documented test-mode payment method tokens. These are not
// secrets and are not real payment instruments - they are fixed IDs Stripe
// itself defines for scripting test-mode scenarios without a browser.
// https://docs.stripe.com/testing#cards
const PM_VISA_SUCCESS = 'pm_card_visa';
const PM_CHARGE_DECLINED = 'pm_card_chargeDeclined';
const PM_AUTHENTICATION_REQUIRED = 'pm_card_authenticationRequired';

const results = [];

function record(name, status, detail) {
  results.push({ name, status, detail });
  const label = status === 'RAN_PASS' ? 'PASS' : status === 'RAN_FAIL' ? 'FAIL' : 'SKIP';
  safeLog(`[${SCRIPT_NAME}] ${label} - ${name}`, detail);
}

async function withCleanup(cleanupFns, fn) {
  try {
    return await fn();
  } finally {
    for (const cleanup of cleanupFns.reverse()) {
      try {
        await cleanup();
      } catch (cleanupError) {
        safeLog(`[${SCRIPT_NAME}] cleanup warning`, cleanupError.message || String(cleanupError));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Scenario: pay-in-full success (pure Stripe API, standalone)
// ---------------------------------------------------------------------------
// A real hosted Checkout Session cannot be completed by a pure API call -
// completing one requires the Checkout UI itself (a browser), which this
// suite intentionally does not drive (see module docstring). This scenario
// instead exercises the underlying charge mechanics Checkout relies on -
// create + confirm a PaymentIntent for the pay_full amount with
// pm_card_visa - which is what "pay-in-full succeeds in Stripe test mode"
// actually reduces to below the hosted-page layer.
async function scenarioPayInFullSuccess(ctx) {
  const name = 'pay-in-full success (PaymentIntent + pm_card_visa)';
  const cleanup = [];
  try {
    await withCleanup(cleanup, async () => {
      const intent = await stripeRequest({
        ...ctx,
        method: 'POST',
        path: '/payment_intents',
        params: {
          amount: PROGRAM_FEE_TOTAL,
          currency: 'usd',
          payment_method: PM_VISA_SUCCESS,
          confirm: true,
          automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
          metadata: { e4la_validation_scenario: 'pay_in_full_success' },
        },
        idempotencyKey: `validation:pay-in-full:${ctx.runId}`,
      });
      assertNoLivemodeObject(intent, name);
      if (intent.status !== 'succeeded') {
        throw new Error(`expected status "succeeded", got "${intent.status}"`);
      }
      // Cleanup: refund the succeeded test charge so this run does not leave
      // a "paid" test PaymentIntent behind. Stripe test-mode refunds are
      // themselves free/instant and do not require any card data.
      cleanup.push(async () => {
        await stripeRequest({
          ...ctx, method: 'POST', path: '/refunds',
          params: { payment_intent: intent.id },
          idempotencyKey: `validation:pay-in-full:refund:${ctx.runId}`,
        });
      });
      record(name, 'RAN_PASS', `payment_intent=${intent.id} status=succeeded amount=${PROGRAM_FEE_TOTAL}`);
    });
  } catch (error) {
    record(name, 'RAN_FAIL', error.message || String(error));
  }
}

// ---------------------------------------------------------------------------
// Scenario: 3-payment / 6-biweekly success path (pure Stripe API, standalone)
// ---------------------------------------------------------------------------
// Builds the Subscription Schedule using the exact same request shape
// functions/_shared/stripe.js's createRemainingInstallmentSchedule() uses:
// a reusable payment method obtained off a confirmed PaymentIntent, then a
// subscription_schedules POST with default_settings.default_payment_method,
// end_behavior "cancel", and a single phase of `remaining` iterations.
async function scenarioInstallmentSchedule(ctx, plan) {
  const name = `${plan.code} installment schedule success (Subscription Schedule)`;
  const price = await findExistingPrice({
    secretKey: ctx.secretKey, apiVersion: ctx.apiVersion, planCode: plan.code, priceNickname: plan.priceNickname,
  });
  if (!price) {
    record(name, 'SKIPPED', `no provisioned Price found for plan "${plan.code}" - run stripe-sandbox-provision.mjs first`);
    return;
  }

  const cleanup = [];
  try {
    await withCleanup(cleanup, async () => {
      const customer = await stripeRequest({
        ...ctx, method: 'POST', path: '/customers',
        params: { name: `E4LA validation - ${plan.code}`, metadata: { e4la_validation_scenario: `${plan.code}_schedule` } },
        idempotencyKey: `validation:customer:${plan.code}:${ctx.runId}`,
      });
      assertNoLivemodeObject(customer, name);
      cleanup.push(async () => {
        await stripeRequest({ ...ctx, method: 'DELETE', path: `/customers/${customer.id}` });
      });

      // Same step createRemainingInstallmentSchedule() relies on: confirm a
      // PaymentIntent for installment #1 with setup_future_usage set so the
      // resulting payment method is reusable, then read paymentIntent.payment_method.
      const initialIntent = await stripeRequest({
        ...ctx, method: 'POST', path: '/payment_intents',
        params: {
          amount: plan.amount, currency: plan.currency, customer: customer.id,
          payment_method: PM_VISA_SUCCESS, confirm: true, setup_future_usage: 'off_session',
          metadata: { e4la_validation_scenario: `${plan.code}_schedule_installment_1` },
        },
        idempotencyKey: `validation:initial-intent:${plan.code}:${ctx.runId}`,
      });
      assertNoLivemodeObject(initialIntent, name);
      if (initialIntent.status !== 'succeeded') throw new Error(`installment #1 PaymentIntent did not succeed: status="${initialIntent.status}"`);
      const paymentMethodId = typeof initialIntent.payment_method === 'string' ? initialIntent.payment_method : initialIntent.payment_method?.id;
      if (!paymentMethodId) throw new Error('Stripe did not return a reusable payment method on the confirmed PaymentIntent.');

      const remaining = plan.remainingSchedule.count;
      const startDate = Math.floor(Date.now() / 1000) + 24 * 3600; // one day out, matches the app never starting the schedule at t=0
      const schedule = await stripeRequest({
        ...ctx, method: 'POST', path: '/subscription_schedules',
        params: {
          customer: customer.id,
          start_date: startDate,
          end_behavior: 'cancel',
          default_settings: { default_payment_method: paymentMethodId },
          phases: [{
            items: [{ price: price.id, quantity: 1 }],
            iterations: remaining,
            metadata: { e4la_validation_scenario: `${plan.code}_schedule`, fixed_installment_schedule: 'true' },
          }],
          metadata: { e4la_validation_scenario: `${plan.code}_schedule`, fixed_installment_schedule: 'true' },
        },
        idempotencyKey: `validation:schedule:${plan.code}:${ctx.runId}`,
      });
      assertNoLivemodeObject(schedule, name);
      cleanup.push(async () => {
        await stripeRequest({ ...ctx, method: 'POST', path: `/subscription_schedules/${schedule.id}/cancel` });
      });
      if (!['not_started', 'active'].includes(schedule.status)) {
        throw new Error(`expected schedule status "not_started" or "active", got "${schedule.status}"`);
      }
      // Cleanup the initial succeeded PaymentIntent too, same as the pay-in-full scenario.
      cleanup.push(async () => {
        await stripeRequest({ ...ctx, method: 'POST', path: '/refunds', params: { payment_intent: initialIntent.id } });
      });

      record(name, 'RAN_PASS', `schedule=${schedule.id} status=${schedule.status} iterations=${remaining} price=${price.id}`);
    });
  } catch (error) {
    record(name, 'RAN_FAIL', error.message || String(error));
  }
}

// ---------------------------------------------------------------------------
// Scenario: first payment failure (pure Stripe API, standalone)
// ---------------------------------------------------------------------------
async function scenarioChargeDeclined(ctx) {
  const name = 'first payment failure (pm_card_chargeDeclined)';
  const cleanup = [];
  try {
    await withCleanup(cleanup, async () => {
      let intent;
      let declined = false;
      let declineMessage = '';
      try {
        intent = await stripeRequest({
          ...ctx, method: 'POST', path: '/payment_intents',
          params: {
            amount: plan1Amount(), currency: 'usd', payment_method: PM_CHARGE_DECLINED, confirm: true,
            automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
            metadata: { e4la_validation_scenario: 'charge_declined' },
          },
          idempotencyKey: `validation:charge-declined:${ctx.runId}`,
        });
      } catch (error) {
        // Stripe returns a card_error and stripeRequest() surfaces it as a
        // thrown Error with the Stripe-provided message - this IS the
        // expected outcome for this scenario.
        declined = true;
        declineMessage = error.message;
      }
      if (intent) {
        assertNoLivemodeObject(intent, name);
        cleanup.push(async () => {
          await stripeRequest({ ...ctx, method: 'POST', path: `/payment_intents/${intent.id}/cancel` }).catch(() => {});
        });
        if (intent.status === 'succeeded') throw new Error('expected the charge to be declined, but it succeeded');
        declined = declined || intent.status !== 'succeeded';
        declineMessage = declineMessage || intent.status;
      }
      if (!declined) throw new Error('expected a decline (either a thrown card_error or a non-succeeded PaymentIntent), got neither');
      record(name, 'RAN_PASS', `Stripe declined as expected: ${declineMessage}`);
    });
  } catch (error) {
    record(name, 'RAN_FAIL', error.message || String(error));
  }
}

// ---------------------------------------------------------------------------
// Scenario: 3DS / authentication-required (pure Stripe API, standalone)
// ---------------------------------------------------------------------------
async function scenarioAuthenticationRequired(ctx) {
  const name = '3DS / authentication-required (pm_card_authenticationRequired)';
  const cleanup = [];
  try {
    await withCleanup(cleanup, async () => {
      const intent = await stripeRequest({
        ...ctx, method: 'POST', path: '/payment_intents',
        params: {
          amount: plan1Amount(), currency: 'usd', payment_method: PM_AUTHENTICATION_REQUIRED, confirm: true,
          automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
          metadata: { e4la_validation_scenario: 'authentication_required' },
        },
        idempotencyKey: `validation:auth-required:${ctx.runId}`,
      });
      assertNoLivemodeObject(intent, name);
      cleanup.push(async () => {
        await stripeRequest({ ...ctx, method: 'POST', path: `/payment_intents/${intent.id}/cancel` }).catch(() => {});
      });
      if (intent.status !== 'requires_action') {
        throw new Error(`expected status "requires_action", got "${intent.status}"`);
      }
      record(name, 'RAN_PASS', `payment_intent=${intent.id} status=requires_action next_action=${intent.next_action?.type || 'unknown'}`);
    });
  } catch (error) {
    record(name, 'RAN_FAIL', error.message || String(error));
  }
}

// ---------------------------------------------------------------------------
// Scenario: schedule creation failure (pure Stripe API, standalone)
// ---------------------------------------------------------------------------
// This is the scenario the app's own attention_required recovery path
// (functions/api/stripe/webhook.js: the createRemainingInstallmentSchedule
// try/catch that flips an enrollment to "attention_required" on failure) is
// designed around, per tests/phase-d-stripe.test.mjs. That test proves the
// app's *handling* of a schedule failure using a mocked fetch; this
// scenario proves the *premise* - that the real Stripe API genuinely
// rejects an invalid schedule payload the same shape createRemainingInstallmentSchedule
// would send, rather than silently accepting it.
async function scenarioInvalidScheduleRejected(ctx) {
  const name = 'schedule creation failure (intentionally invalid payload is rejected)';
  try {
    let rejected = false;
    let rejectionMessage = '';
    try {
      await stripeRequest({
        ...ctx, method: 'POST', path: '/subscription_schedules',
        params: {
          // No customer provided and a nonexistent Price - Stripe must
          // reject this; if it somehow did not, that would be the real gap
          // the app's attention_required recovery path is protecting against.
          start_date: Math.floor(Date.now() / 1000) + 3600,
          end_behavior: 'cancel',
          phases: [{ items: [{ price: 'price_does_not_exist_e4la_validation', quantity: 1 }], iterations: 2 }],
          metadata: { e4la_validation_scenario: 'invalid_schedule' },
        },
        idempotencyKey: `validation:invalid-schedule:${ctx.runId}`,
      });
    } catch (error) {
      rejected = true;
      rejectionMessage = error.message;
    }
    if (!rejected) throw new Error('expected Stripe to reject the invalid schedule payload, but it was accepted');
    record(name, 'RAN_PASS', `Stripe rejected as expected: ${rejectionMessage}`);
  } catch (error) {
    record(name, 'RAN_FAIL', error.message || String(error));
  }
}

// ---------------------------------------------------------------------------
// Scenario: forged plan / forged amount rejection - app-level, not Stripe-API-level
// ---------------------------------------------------------------------------
function scenarioForgedPlanRejection() {
  // This is entirely about E4LA's own server-side enforcement (the checkout
  // endpoint always resolves price/amount from the D1 payment_plans row,
  // never from client input) - Stripe's API has no opinion on it, so there
  // is nothing for this suite to call. Already covered and already passing:
  // tests/phase-d-stripe.test.mjs -> 'server-side canonical plan/price
  // values cannot be overridden by the client during agreement acceptance'.
  record(
    'forged plan / forged amount rejection',
    'SKIPPED',
    'app-level server-side enforcement, not a Stripe API behavior - see tests/phase-d-stripe.test.mjs ("server-side canonical plan/price values cannot be overridden...")',
  );
}

// ---------------------------------------------------------------------------
// Scenarios that require the app's own live webhook/session endpoints
// ---------------------------------------------------------------------------
function scenarioRequiresLivePreview(name) {
  record(name, 'SKIPPED', 'requires live preview deployment + Access, not runnable standalone against pure Stripe test-mode API');
}

function plan1Amount() {
  const payFull = PLANS.find((plan) => plan.code === 'pay_full');
  return payFull ? payFull.amount : PROGRAM_FEE_TOTAL;
}

function printFinalSummary() {
  console.log('');
  console.log(`[${SCRIPT_NAME}] CONFIGURED / TESTED / EVIDENCE / REGRESSION CHECK summary`);
  console.log('');
  const ran = results.filter((r) => r.status !== 'SKIPPED');
  const skipped = results.filter((r) => r.status === 'SKIPPED');
  const failed = results.filter((r) => r.status === 'RAN_FAIL');
  console.log(`  CONFIGURED: this run assumed scripts/gate-prep/stripe-sandbox-provision.mjs has already run against this account.`);
  console.log(`  TESTED: ${ran.length} scenario(s) executed against the real Stripe test-mode API (${ran.length - failed.length} passed, ${failed.length} failed).`);
  console.log(`  EVIDENCE: see the RAN/SKIPPED lines above and below for object IDs and Stripe-reported statuses for each scenario.`);
  console.log(`  REGRESSION CHECK: forged plan/amount enforcement is cross-referenced to the already-passing tests/phase-d-stripe.test.mjs, not re-run here.`);
  console.log('');
  console.log('  Scenario ledger:');
  for (const { name, status, detail } of results) {
    const label = status === 'RAN_PASS' ? 'RAN (pass)' : status === 'RAN_FAIL' ? 'RAN (FAIL)' : 'SKIPPED';
    console.log(`    [${label}] ${name}`);
    console.log(`        ${detail}`);
  }
  console.log('');
  console.log(`  ${skipped.length} scenario(s) skipped (see reasons above).`);
}

export async function runValidationSuite() {
  printModeBanner(SCRIPT_NAME);

  // Guardrail check MUST run before anything else - before any network call.
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
  const ctx = { secretKey, apiVersion, runId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };

  // Pure-Stripe-API, standalone-runnable scenarios.
  await scenarioPayInFullSuccess(ctx);
  const installmentPlans = PLANS.filter((plan) => plan.remainingSchedule);
  for (const plan of installmentPlans) {
    // eslint-disable-next-line no-await-in-loop
    await scenarioInstallmentSchedule(ctx, plan);
  }
  await scenarioChargeDeclined(ctx);
  await scenarioAuthenticationRequired(ctx);
  await scenarioInvalidScheduleRejected(ctx);

  // Not Stripe-API scenarios - documented cross-references / skips.
  scenarioForgedPlanRejection();
  scenarioRequiresLivePreview('duplicate webhook delivery is idempotent');
  scenarioRequiresLivePreview('delayed webhook still reconciles correctly once it arrives');
  scenarioRequiresLivePreview('out-of-order webhook events reconcile to the correct final state');
  scenarioRequiresLivePreview('Billing Portal Owner-vs-Viewer role gating');

  printFinalSummary();

  const anyFailed = results.some((r) => r.status === 'RAN_FAIL');
  return anyFailed ? 1 : 0;
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  runValidationSuite().then((code) => process.exit(code));
}
