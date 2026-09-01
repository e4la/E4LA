import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  GuardrailError, redact, requireEnv, optionalEnv, isDryRun, isPreviewOnly,
  assertNotProductionHostname, assertProductionActionExplicitlyConfirmed,
  assertTestModeStripeKey, assertNoLivemodeObject, assertPreviewDatabaseIdentity,
  assertAllowlistedRecipient,
} from '../scripts/gate-prep/lib/guardrails.mjs';

// Phase F: unit coverage for the shared safety guardrails every external-gate
// preparation script (Cloudflare Access, D1 migrations, Stripe Sandbox,
// Resend preview) is built on. These are pure functions with no network or
// filesystem access, so every scenario below runs with zero external
// dependencies and zero side effects.

test('redact hides Stripe secret/webhook keys and bearer tokens, leaves ordinary text alone', () => {
  assert.equal(redact('sk_test_abc123'), '[redacted:stripe-secret]');
  assert.equal(redact('sk_live_abc123'), '[redacted:stripe-secret]');
  assert.equal(redact('whsec_abc123'), '[redacted:stripe-secret]');
  assert.equal(redact('Bearer abcdef123456'), '[redacted:bearer-token]');
  assert.equal(redact(undefined), undefined);
  assert.equal(redact(null), null);
  assert.equal(redact('preview'), 'preview');
  assert.equal(redact('agreement_invitation'), 'agreement_invitation');
});

test('redact truncates long opaque-looking tokens even without a known prefix', () => {
  const longToken = 'a'.repeat(40);
  const result = redact(longToken);
  assert.match(result, /^aaaa…\[redacted:40 chars\]$/);
  assert.ok(!result.includes(longToken), 'the full token must never appear in the redacted output');
});

test('requireEnv throws a clear GuardrailError-shaped message when unset, returns the value when set', () => {
  delete process.env.PHASE_F_TEST_VAR;
  assert.throws(() => requireEnv('PHASE_F_TEST_VAR'), (error) => error instanceof GuardrailError && /Missing required environment variable: PHASE_F_TEST_VAR/.test(error.message));
  process.env.PHASE_F_TEST_VAR = 'value';
  assert.equal(requireEnv('PHASE_F_TEST_VAR'), 'value');
  delete process.env.PHASE_F_TEST_VAR;
});

test('optionalEnv returns the fallback when unset or empty, the real value otherwise', () => {
  delete process.env.PHASE_F_OPTIONAL;
  assert.equal(optionalEnv('PHASE_F_OPTIONAL', 'fallback'), 'fallback');
  process.env.PHASE_F_OPTIONAL = '';
  assert.equal(optionalEnv('PHASE_F_OPTIONAL', 'fallback'), 'fallback');
  process.env.PHASE_F_OPTIONAL = 'real-value';
  assert.equal(optionalEnv('PHASE_F_OPTIONAL', 'fallback'), 'real-value');
  delete process.env.PHASE_F_OPTIONAL;
});

test('isDryRun / isPreviewOnly read exactly the documented env var values', () => {
  delete process.env.DRY_RUN; assert.equal(isDryRun(), false);
  process.env.DRY_RUN = '1'; assert.equal(isDryRun(), true);
  process.env.DRY_RUN = 'true'; assert.equal(isDryRun(), true);
  process.env.DRY_RUN = '0'; assert.equal(isDryRun(), false);
  delete process.env.DRY_RUN;

  delete process.env.PREVIEW_ONLY; assert.equal(isPreviewOnly(), true, 'defaults to true (safe) when unset');
  process.env.PREVIEW_ONLY = '0'; assert.equal(isPreviewOnly(), false);
  process.env.PREVIEW_ONLY = 'false'; assert.equal(isPreviewOnly(), false);
  process.env.PREVIEW_ONLY = '1'; assert.equal(isPreviewOnly(), true);
  delete process.env.PREVIEW_ONLY;
});

test('assertNotProductionHostname rejects e4la.org and every subdomain of it, accepts the real preview hostname', () => {
  assert.throws(() => assertNotProductionHostname('e4la.org'), GuardrailError);
  assert.throws(() => assertNotProductionHostname('www.e4la.org'), GuardrailError);
  assert.throws(() => assertNotProductionHostname('admin.e4la.org'), GuardrailError);
  assert.throws(() => assertNotProductionHostname(''), GuardrailError, 'no hostname at all must also be refused, not treated as safe');
  assert.throws(() => assertNotProductionHostname(undefined), GuardrailError);
  assert.doesNotThrow(() => assertNotProductionHostname('e4la-client-operations-preview.pages.dev'));
  assert.doesNotThrow(() => assertNotProductionHostname('56f14ffe.e4la-client-operations-preview.pages.dev'));
});

test('assertNotProductionHostname is not fooled by a hostname that merely contains "e4la.org" as a substring elsewhere', () => {
  // e.g. a phishing-adjacent or accidental typo domain should not be treated as production
  // just because it contains the string - but a genuine subdomain must still be caught.
  assert.doesNotThrow(() => assertNotProductionHostname('e4la.org.evil.example'));
  assert.throws(() => assertNotProductionHostname('sub.e4la.org'), GuardrailError);
});

test('assertProductionActionExplicitlyConfirmed requires the exact confirmation phrase, nothing weaker', () => {
  delete process.env.PRODUCTION_ACTION_CONFIRMED;
  assert.throws(() => assertProductionActionExplicitlyConfirmed('test context'), GuardrailError);
  process.env.PRODUCTION_ACTION_CONFIRMED = 'true';
  assert.throws(() => assertProductionActionExplicitlyConfirmed('test context'), GuardrailError, 'a generic truthy value must not satisfy this guard');
  process.env.PRODUCTION_ACTION_CONFIRMED = 'yes';
  assert.throws(() => assertProductionActionExplicitlyConfirmed('test context'), GuardrailError);
  process.env.PRODUCTION_ACTION_CONFIRMED = 'I-UNDERSTAND';
  assert.doesNotThrow(() => assertProductionActionExplicitlyConfirmed('test context'));
  delete process.env.PRODUCTION_ACTION_CONFIRMED;
});

test('assertTestModeStripeKey accepts only sk_test_/rk_test_ prefixed keys, rejects live keys and garbage', () => {
  assert.doesNotThrow(() => assertTestModeStripeKey('sk_test_abc123'));
  assert.doesNotThrow(() => assertTestModeStripeKey('rk_test_abc123'));
  assert.throws(() => assertTestModeStripeKey('sk_live_abc123'), GuardrailError);
  assert.throws(() => assertTestModeStripeKey('rk_live_abc123'), GuardrailError);
  assert.throws(() => assertTestModeStripeKey('not_a_stripe_key'), GuardrailError);
  assert.throws(() => assertTestModeStripeKey(''), GuardrailError);
  assert.throws(() => assertTestModeStripeKey(undefined), GuardrailError);
});

test('assertNoLivemodeObject rejects any object with livemode:true, allows everything else', () => {
  assert.throws(() => assertNoLivemodeObject({ livemode: true, id: 'prod_x' }), GuardrailError);
  assert.doesNotThrow(() => assertNoLivemodeObject({ livemode: false, id: 'prod_x' }));
  assert.doesNotThrow(() => assertNoLivemodeObject({ id: 'prod_x' }), 'an object with no livemode field at all should not be treated as a violation');
  assert.doesNotThrow(() => assertNoLivemodeObject(null));
  assert.doesNotThrow(() => assertNoLivemodeObject(undefined));
});

test('assertPreviewDatabaseIdentity only accepts an exact database name match', () => {
  assert.doesNotThrow(() => assertPreviewDatabaseIdentity('e4la-client-operations-preview', 'e4la-client-operations-preview'));
  assert.throws(() => assertPreviewDatabaseIdentity('e4la-client-operations-production', 'e4la-client-operations-preview'), GuardrailError);
  assert.throws(() => assertPreviewDatabaseIdentity('', 'e4la-client-operations-preview'), GuardrailError);
  assert.throws(() => assertPreviewDatabaseIdentity(undefined, 'e4la-client-operations-preview'), GuardrailError);
});

test('assertAllowlistedRecipient is case-insensitive but exact, and refuses every non-listed address', () => {
  const allowlist = ['owner@example.test', 'Viewer@Example.test'];
  assert.doesNotThrow(() => assertAllowlistedRecipient('owner@example.test', allowlist));
  assert.doesNotThrow(() => assertAllowlistedRecipient('OWNER@EXAMPLE.TEST', allowlist), 'matching must be case-insensitive');
  assert.doesNotThrow(() => assertAllowlistedRecipient('viewer@example.test', allowlist));
  assert.throws(() => assertAllowlistedRecipient('someone-else@example.test', allowlist), GuardrailError);
  assert.throws(() => assertAllowlistedRecipient('owner@example.test.evil.example', allowlist), GuardrailError, 'a superstring of an allowlisted address must not match');
  assert.throws(() => assertAllowlistedRecipient('', allowlist), GuardrailError);
  assert.throws(() => assertAllowlistedRecipient('owner@example.test', []), GuardrailError, 'an empty allowlist must refuse everyone, not fail open');
});
