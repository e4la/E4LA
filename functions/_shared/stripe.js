import { HttpError } from './ops-security.js';

function stripeKey(env) {
  const key = String(env.STRIPE_SECRET_KEY || '');
  if (!key) throw new HttpError(503, 'stripe_not_configured', 'Secure payment setup is not configured yet.');
  if (key.startsWith('sk_live_')) {
    throw new HttpError(503, 'live_billing_blocked', 'Live billing is intentionally disabled during preview validation.');
  }
  if (!key.startsWith('sk_test_')) throw new HttpError(503, 'stripe_key_invalid', 'Stripe test-mode configuration is invalid.');
  return key;
}

export async function stripeRequest(env, method, path, parameters = null, idempotencyKey = null) {
  const key = stripeKey(env);
  const apiVersion = String(env.STRIPE_API_VERSION || '').trim();
  if (!apiVersion || apiVersion === 'CONFIRM_IN_STRIPE_WORKBENCH') {
    throw new HttpError(503, 'stripe_api_version_not_configured', 'Confirm the Stripe sandbox API version in Workbench before enabling payment requests.');
  }
  const headers = {
    Authorization: `Bearer ${key}`,
    'Stripe-Version': apiVersion,
  };
  let body;
  if (parameters) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = encodeParameters(parameters);
  }
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const response = await fetch(`https://api.stripe.com/v1${path}`, { method, headers, body });
  const payload = await response.json();
  if (!response.ok) {
    const safeMessage = payload?.error?.message || 'Stripe could not complete the request.';
    throw new HttpError(502, 'stripe_request_failed', safeMessage);
  }
  if (payload.livemode === true) throw new HttpError(503, 'live_billing_blocked', 'Live billing is disabled during preview validation.');
  return payload;
}

function encodeParameters(value, prefix = '', output = new URLSearchParams()) {
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

export async function createCheckoutSession(env, enrollment, plan, customerId, agreementPath) {
  const origin = String(env.PUBLIC_SITE_URL || '').replace(/\/$/, '');
  if (!origin) throw new HttpError(503, 'site_url_not_configured', 'The secure return URL is not configured.');
  const isInstallment = Number(plan.installment_count) > 1;
  return stripeRequest(env, 'POST', '/checkout/sessions', {
    mode: 'payment',
    customer: customerId,
    payment_method_types: ['card'],
    client_reference_id: enrollment.id,
    line_items: [{ price: plan.stripe_initial_price_id, quantity: 1 }],
    payment_intent_data: isInstallment ? { setup_future_usage: 'off_session' } : undefined,
    invoice_creation: isInstallment ? undefined : { enabled: true },
    metadata: {
      e4la_enrollment_id: enrollment.id,
      e4la_agreement_id: enrollment.agreement_id,
      e4la_payment_plan_id: plan.id,
    },
    success_url: `${origin}${agreementPath}#checkout-returned`,
    cancel_url: `${origin}${agreementPath}#checkout-cancelled`,
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
  }, `checkout:${enrollment.id}:${plan.id}`);
}

export async function createRemainingInstallmentSchedule(env, enrollment, plan, paymentIntentId, dueAt) {
  if (Number(plan.installment_count) <= 1) return null;
  if (!plan.stripe_remaining_price_id) throw new HttpError(503, 'stripe_plan_incomplete', 'The remaining installment price is not configured.');
  const paymentIntent = await stripeRequest(env, 'GET', `/payment_intents/${encodeURIComponent(paymentIntentId)}`);
  const paymentMethodId = typeof paymentIntent.payment_method === 'string'
    ? paymentIntent.payment_method
    : paymentIntent.payment_method?.id;
  if (!paymentMethodId) throw new HttpError(502, 'payment_method_missing', 'Stripe did not return a reusable payment method.');
  const remaining = Number(plan.installment_count) - 1;
  return stripeRequest(env, 'POST', '/subscription_schedules', {
    customer: paymentIntent.customer,
    start_date: Math.floor(new Date(dueAt).getTime() / 1000),
    end_behavior: 'cancel',
    default_settings: { default_payment_method: paymentMethodId },
    phases: [{
      items: [{ price: plan.stripe_remaining_price_id, quantity: 1 }],
      iterations: remaining,
      metadata: {
        e4la_enrollment_id: enrollment.id,
        e4la_agreement_id: enrollment.agreement_id,
        fixed_installment_schedule: 'true',
      },
    }],
    metadata: {
      e4la_enrollment_id: enrollment.id,
      e4la_agreement_id: enrollment.agreement_id,
      fixed_installment_schedule: 'true',
    },
  }, `schedule:${enrollment.id}`);
}

export async function createBillingPortalSession(env, customerId, returnPath) {
  if (!env.STRIPE_PORTAL_CONFIGURATION_ID) {
    throw new HttpError(503, 'billing_portal_not_configured', 'Billing access is not configured yet.');
  }
  const origin = String(env.PUBLIC_SITE_URL || '').replace(/\/$/, '');
  return stripeRequest(env, 'POST', '/billing_portal/sessions', {
    customer: customerId,
    configuration: env.STRIPE_PORTAL_CONFIGURATION_ID,
    return_url: `${origin}${returnPath}`,
  });
}

export async function verifyStripeSignature(rawBody, signatureHeader, secret, toleranceSeconds = 300) {
  if (!signatureHeader || !secret) return false;
  const parts = signatureHeader.split(',').map((part) => part.split('='));
  const timestamp = parts.find(([key]) => key === 't')?.[1];
  const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => value);
  if (!timestamp || !signatures.length) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > toleranceSeconds) return false;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const expectedBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${rawBody}`));
  const expected = [...new Uint8Array(expectedBuffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return signatures.some((candidate) => constantTimeEqual(expected, candidate));
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}
