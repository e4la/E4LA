// Desired Stripe Sandbox (test-mode only) product/price configuration for
// the three E4LA payment plans. Matches the canonical amounts/counts already
// enforced server-side in functions/_shared/stripe.js and
// functions/api/ops/[[path]].js - this file does not define new commercial
// terms, it only describes how to represent the existing ones in Stripe.
//
// Imported by scripts/gate-prep/stripe-sandbox-provision.mjs. All amounts
// are in cents, matching how the app already stores them.

export const PROGRAM_FEE_TOTAL = 360000; // $3,600

export const PLANS = [
  {
    code: 'pay_full',
    productName: 'E4LA 90-Day Growth Program - Pay in Full',
    priceNickname: 'pay_full_360000',
    amount: PROGRAM_FEE_TOTAL,
    currency: 'usd',
    type: 'one_time',
  },
  {
    code: 'three_monthly',
    productName: 'E4LA 90-Day Growth Program - Three Monthly Installments',
    priceNickname: 'three_monthly_checkout_120000',
    // Checkout collects installment #1 only. Installments #2-3 are created
    // afterward as a Subscription Schedule by functions/_shared/stripe.js -
    // this price exists solely for the Checkout Session's line item.
    amount: 120000,
    currency: 'usd',
    type: 'one_time',
    remainingSchedule: { count: 2, intervalUnit: 'month', intervalCount: 1, amount: 120000 },
  },
  {
    code: 'six_biweekly',
    productName: 'E4LA 90-Day Growth Program - Six Biweekly Installments',
    priceNickname: 'six_biweekly_checkout_60000',
    amount: 60000,
    currency: 'usd',
    type: 'one_time',
    remainingSchedule: { count: 5, intervalUnit: 'week', intervalCount: 2, amount: 60000 },
  },
];

// Matches functions/_shared/stripe.js's remaining-schedule builder exactly -
// changing this without changing that file (or vice versa) would desync
// provisioning from what the app actually creates at runtime.
export const SCHEDULE_END_BEHAVIOR = 'cancel';

export const CUSTOMER_PORTAL_CONFIGURATION = {
  // Matches CLAUDE-HANDOFF section K/L: payment method + invoices only.
  features: {
    payment_method_update: { enabled: true },
    invoice_history: { enabled: true },
    // Explicitly disabled - a committed installment schedule is not
    // client-cancellable or re-plannable through the Portal.
    subscription_cancel: { enabled: false },
    subscription_update: { enabled: false },
    customer_update: { enabled: false },
  },
};

export const REQUIRED_PREVIEW_ENV_VARS = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_API_VERSION',
  'STRIPE_PORTAL_CONFIGURATION_ID',
];

// Webhook events functions/api/stripe/webhook.js actually handles - the
// Sandbox webhook endpoint must be configured to send exactly these, no
// more (unused events are just noise the handler 200s-and-ignores) and no
// fewer (missing one silently breaks reconciliation).
export const REQUIRED_WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.expired',
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.payment_action_required',
  'subscription_schedule.completed',
  'subscription_schedule.updated',
  'subscription_schedule.canceled',
  'subscription_schedule.aborted',
];
