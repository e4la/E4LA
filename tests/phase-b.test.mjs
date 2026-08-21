import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { formatMoney, normalizeName, sampleAgreement, validateAgreement } from '../assets/js/ops-model.js';
import { authenticate, requireCsrf, requireJson, requireTrustedOrigin, securityHeaders, sessionCookie, sha256 } from '../functions/_shared/ops-security.js';
import { stripeRequest, verifyStripeSignature } from '../functions/_shared/stripe.js';

test('development payment plans preserve one fixed $3,600 program fee', () => {
  assert.equal(sampleAgreement.paymentPlans.length, 3);
  for (const plan of sampleAgreement.paymentPlans) {
    assert.equal(plan.total, 360000);
    assert.equal(plan.schedule.reduce((sum, installment) => sum + installment.amount, 0), 360000);
  }
  assert.equal(formatMoney(360000), '$3,600');
});

test('agreement validation requires identity, authority, schedule, and every clause', () => {
  const errors = validateAgreement({ acknowledgedClauseIds: [] });
  assert.equal(errors.legalBusinessName, 'This field is required.');
  assert.ok(errors.paymentPlanId);
  assert.ok(errors.clientAuthority);
  assert.ok(errors.signerAuthority);
  assert.ok(errors.acknowledgements);
});

test('typed acceptance must match the normalized signer name', () => {
  assert.equal(normalizeName('  Ada   Lovelace '), 'ada lovelace');
  const valid = {
    legalBusinessName: 'Example LLC', contactName: 'Ada Lovelace', email: 'ada@example.test', phone: '555-0100',
    title: 'Owner', billingAddress: '1 Example Way', city: 'Los Angeles', state: 'CA', zip: '90001',
    signerName: 'Ada Lovelace', signerRole: 'Owner', signerCompany: 'Example LLC', typedAcceptance: 'ADA  LOVELACE',
    paymentPlanId: 'plan_full', clientAuthority: true, signerAuthority: true,
    acknowledgedClauseIds: sampleAgreement.agreement.clauses.map((clause) => clause.id),
  };
  assert.deepEqual(validateAgreement(valid), {});
  assert.equal(validateAgreement({ ...valid, typedAcceptance: 'Another Person' }).typedAcceptance, 'Your electronic signature must match your full legal name.');
});

test('API security headers prevent caching, framing, indexing, and referrer leakage', () => {
  const headers = securityHeaders({ 'Cache-Control': 'no-store' });
  assert.equal(headers.get('Cache-Control'), 'no-store');
  assert.equal(headers.get('X-Frame-Options'), 'DENY');
  assert.equal(headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(headers.get('Referrer-Policy'), 'no-referrer');
  assert.match(headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
  assert.match(headers.get('X-Robots-Tag'), /noindex/);
});

test('Stripe webhook verification checks timestamp and HMAC', async () => {
  const secret = 'whsec_phase_b_test';
  const body = '{"id":"evt_test","livemode":false}';
  const timestamp = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`));
  const signature = [...new Uint8Array(signed)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  assert.equal(await verifyStripeSignature(body, `t=${timestamp},v1=${signature}`, secret), true);
  assert.equal(await verifyStripeSignature(`${body}x`, `t=${timestamp},v1=${signature}`, secret), false);
  assert.equal((await sha256('invite-token')).length, 64);
});

test('request validation rejects cross-origin and non-JSON mutations', () => {
  const crossOrigin = new Request('https://e4la.org/api/ops/checkout', { method: 'POST', headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' } });
  assert.throws(() => requireTrustedOrigin(crossOrigin, { PUBLIC_SITE_URL: 'https://e4la.org' }), (error) => error.code === 'origin_rejected');
  const formPost = new Request('https://e4la.org/api/ops/checkout', { method: 'POST', headers: { Origin: 'https://e4la.org', 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert.throws(() => requireJson(formPost), (error) => error.code === 'unsupported_media_type');
});

test('unauthorized and CSRF-invalid requests fail closed', async () => {
  await assert.rejects(authenticate(new Request('https://e4la.org/api/ops/portal'), {}), (error) => error.code === 'authentication_required');
  const request = new Request('https://e4la.org/api/ops/checkout', { headers: { 'X-CSRF-Token': 'wrong' } });
  await assert.rejects(requireCsrf(request, { csrf_hash: await sha256('correct') }), (error) => error.code === 'csrf_rejected');
  const cookie = sessionCookie('opaque-token', 1800);
  assert.match(cookie, /^__Host-e4la_ops=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
});

test('live Stripe credentials are blocked before any network request', async () => {
  await assert.rejects(
    stripeRequest({ STRIPE_SECRET_KEY: 'sk_live_never_use_in_phase_b' }, 'GET', '/customers'),
    (error) => error.code === 'live_billing_blocked',
  );
});

test('application source does not persist private data in browser storage or collect card fields', async () => {
  const files = ['../assets/js/client-agreement.js','../assets/js/client-portal.js','../assets/js/admin.js'];
  for (const file of files) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /localStorage|sessionStorage/);
  }
  const agreementHtml = await readFile(new URL('../client-agreement/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(agreementHtml, /card number|cvv|cvc/i);
  assert.match(agreementHtml, /meta name="robots" content="noindex, nofollow, noarchive"/);
  const repositoryFiles = [
    '../functions/_shared/stripe.js','../functions/api/ops/[[path]].js','../functions/api/stripe/webhook.js',
    '../client-agreement/index.html','../client-portal/index.html','../admin/index.html',
  ];
  for (const file of repositoryFiles) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /sk_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}/);
  }
});

test('private routes keep SEO, CSP, responsive, and reduced-motion safeguards isolated', async () => {
  for (const file of ['../client-agreement/index.html','../client-portal/index.html','../admin/index.html']) {
    const html = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.match(html, /noindex, nofollow, noarchive/);
    assert.match(html, /frame-ancestors 'none'/);
    assert.match(html, /class="ops-skip"/);
    assert.doesNotMatch(html, /style=/);
  }
  const css = await readFile(new URL('../assets/css/operations.css', import.meta.url), 'utf8');
  assert.match(css, /@media \(max-width: 980px\)/);
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  const redirects = await readFile(new URL('../_redirects', import.meta.url), 'utf8');
  assert.match(redirects, /\/client-agreement\/\*/);
  assert.match(redirects, /\/client-portal\/\*/);
  assert.match(redirects, /\/admin\/\*/);
  const sitemap = await readFile(new URL('../sitemap.xml', import.meta.url), 'utf8');
  assert.doesNotMatch(sitemap, /client-agreement|client-portal|\/admin/);
});
