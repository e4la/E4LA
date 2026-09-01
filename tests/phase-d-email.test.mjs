import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { renderOperationsEmail } from '../functions/_shared/email-templates.js';

// Phase D scope: Resend/email readiness audit only. Legal agreement text and the
// authz/Stripe code paths owned by other concurrent agents are out of scope and are
// not touched or asserted on here beyond read-only investigation reported separately.

const migration1 = await readFile(new URL('../migrations/0001_client_operations.sql', import.meta.url), 'utf8');
const migration2 = await readFile(new URL('../migrations/0002_phase_c_preview.sql', import.meta.url), 'utf8');
const migration3 = await readFile(new URL('../migrations/0003_payment_plans_immutable.sql', import.meta.url), 'utf8');
const migration4 = await readFile(new URL('../migrations/0004_project_progress.sql', import.meta.url), 'utf8');

function freshDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec(migration1);
  database.exec(migration2);
  database.exec(migration3);
  database.exec(migration4);
  return database;
}

const ALL_TYPES = [
  'agreement_invitation', 'agreement_accepted', 'payment_confirmation',
  'payment_failure', 'portal_activation', 'onboarding_instructions',
];

test('renderOperationsEmail makes no network calls of any kind', () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('renderOperationsEmail must never perform network I/O'); };
  try {
    for (const type of ALL_TYPES) {
      assert.doesNotThrow(() => renderOperationsEmail(type, {
        clientName: 'Fictional Client', programName: 'Preview Program',
        actionUrl: 'https://preview.example/action', paymentSummary: 'Fictional summary', nextStep: 'Fictional next step',
      }));
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('renderOperationsEmail rejects an unsupported template type', () => {
  assert.throws(() => renderOperationsEmail('not_a_real_template', {}), /Unsupported Client Operations email type/);
});

test('each of the six templates interpolates real client/program/context data instead of leaking fallback placeholders', () => {
  for (const type of ALL_TYPES) {
    const distinctClient = `Fictional Client ${type}`;
    const distinctProgram = `Fictional Program ${type}`;
    const distinctSummary = `Fictional payment summary for ${type}`;
    const distinctNextStep = `Fictional next step for ${type}`;
    const template = renderOperationsEmail(type, {
      clientName: distinctClient,
      programName: distinctProgram,
      actionUrl: 'https://preview.example/action',
      paymentSummary: distinctSummary,
      nextStep: distinctNextStep,
    });
    // The greeting must reflect the real client name, not the "there" fallback.
    assert.match(template.text, new RegExp(`Hi ${distinctClient},`));
    assert.match(template.html, new RegExp(`Hi ${distinctClient},`));
    assert.doesNotMatch(template.text, /Hi there,/);
    // Program name must appear in subject or body for every lifecycle stage that names it.
    if (['agreement_invitation', 'agreement_accepted', 'payment_confirmation', 'onboarding_instructions'].includes(type)) {
      assert.match(template.subject, new RegExp(distinctProgram.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.doesNotMatch(template.subject, /your E4LA engagement/);
    }
    if (type === 'payment_confirmation') {
      assert.match(template.text, new RegExp(distinctSummary));
      assert.doesNotMatch(template.text, /Stripe confirmed the required program payment\./);
    }
    if (type === 'onboarding_instructions') {
      assert.match(template.text, new RegExp(distinctNextStep));
    }
    if (type === 'agreement_accepted') {
      assert.match(template.text, new RegExp(distinctNextStep));
    }
  }
});

test('the plain-text body includes the same disclaimer/note content as the HTML body, not just the HTML version', () => {
  // Regression for a real gap: the text template previously omitted `content.note` entirely,
  // so text-only mail clients never saw payment_failure's "do not send card numbers" warning,
  // or agreement_accepted/payment_confirmation/onboarding_instructions' dynamic nextStep note.
  const failure = renderOperationsEmail('payment_failure', { clientName: 'Fictional Client', programName: 'Preview Program' });
  assert.match(failure.text, /Do not send card numbers or payment credentials by email\./);
  assert.match(failure.html, /Do not send card numbers or payment credentials by email\./);

  const accepted = renderOperationsEmail('agreement_accepted', { clientName: 'Fictional Client', programName: 'Preview Program', nextStep: 'Fictional distinctive next step text' });
  assert.match(accepted.text, /Fictional distinctive next step text/);
  assert.match(accepted.html, /Fictional distinctive next step text/);
});

test('a template with no actionUrl omits the action button/link entirely', () => {
  const template = renderOperationsEmail('agreement_invitation', { clientName: 'Fictional Client', programName: 'Preview Program' });
  assert.doesNotMatch(template.html, /<a href=/);
  assert.doesNotMatch(template.text, /Review agreement:/);
});

test('agreement_accepted has no call to action by design even when an actionUrl is supplied', () => {
  const template = renderOperationsEmail('agreement_accepted', {
    clientName: 'Fictional Client', programName: 'Preview Program', actionUrl: 'https://preview.example/action',
  });
  assert.doesNotMatch(template.html, /<a href=/);
});

test('safeUrl only accepts https URLs, rejecting javascript:, data:, and plain http', () => {
  const cases = ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'http://insecure.example/action', 'not a url at all'];
  for (const unsafe of cases) {
    const template = renderOperationsEmail('agreement_invitation', { clientName: 'Fictional Client', programName: 'Preview Program', actionUrl: unsafe });
    assert.doesNotMatch(template.html, /<a href=/, `expected no action link for unsafe URL: ${unsafe}`);
  }
  const safe = renderOperationsEmail('agreement_invitation', { clientName: 'Fictional Client', programName: 'Preview Program', actionUrl: 'https://preview.example/action?x=1' });
  assert.match(safe.html, /https:\/\/preview\.example\/action\?x=1/);
});

test('oversized attacker-controlled fields are truncated rather than fully reflected', () => {
  const longName = 'A'.repeat(5000);
  const template = renderOperationsEmail('agreement_invitation', { clientName: longName, programName: 'Preview Program' });
  assert.ok(!template.text.includes(longName), 'clientName over the 160-character cap must be truncated');
  assert.ok(template.text.includes('A'.repeat(160)), 'truncation should keep the first 160 characters');
});

test('no secrets, tokens, card-like numbers, or internal IDs leak into any rendered template', () => {
  for (const type of ALL_TYPES) {
    const template = renderOperationsEmail(type, {
      clientName: 'Fictional Client', programName: 'Preview Program',
      actionUrl: 'https://preview.example/action?token=should-not-appear-in-source-but-is-caller-controlled',
      paymentSummary: 'Fictional summary', nextStep: 'Fictional next step',
      supportEmail: 'hello@e4la.org',
    });
    assert.doesNotMatch(template.html, /sk_(live|test)_|whsec_|\b\d{13,19}\b|cvv/i);
    assert.doesNotMatch(template.text, /sk_(live|test)_|whsec_|\b\d{13,19}\b|cvv/i);
  }
});

test('email-templates.js itself contains no Resend SDK usage, no fetch, and no hardcoded production sender', () => {
  // This is the inert-rendering boundary the handoff doc requires: email-templates.js
  // renders strings only and must never itself perform delivery.
  return readFile(new URL('../functions/_shared/email-templates.js', import.meta.url), 'utf8').then((source) => {
    assert.doesNotMatch(source, /fetch\(/);
    assert.doesNotMatch(source, /resend/i);
    assert.doesNotMatch(source, /RESEND_API_KEY/);
    // hello@e4la.org appears only as a display "Questions? Contact ..." fallback, never as a `from:` sender field.
    assert.doesNotMatch(source, /from\s*:\s*['"]/);
  });
});

test('outbound_message_events.idempotency_key is UNIQUE, so a duplicate dispatch attempt cannot record twice', () => {
  // This proves the *schema-level* dedup primitive works. It intentionally does not assert
  // anything about functions/api/ops/[[path]].js or functions/api/stripe/webhook.js (owned by
  // other in-progress agents this run) — see the written report for the current wiring status.
  const database = freshDatabase();
  const insert = () => database.prepare(`INSERT INTO outbound_message_events (
    id, message_type, idempotency_key, recipient_email_normalized, status, created_at, updated_at
  ) VALUES (?, 'payment_confirmation', 'stripe_invoice:in_fixture_1', 'fictional-client@example.test', 'pending', ?, ?)`)
    .run(crypto.randomUUID(), new Date().toISOString(), new Date().toISOString());
  assert.doesNotThrow(insert);
  assert.throws(insert, /UNIQUE constraint failed: outbound_message_events\.idempotency_key/);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM outbound_message_events').get().count, 1);
  database.close();
});

test('outbound_message_events accepts one row per distinct idempotency key for the same message_type', () => {
  const database = freshDatabase();
  const statement = database.prepare(`INSERT INTO outbound_message_events (
    id, message_type, idempotency_key, recipient_email_normalized, status, created_at, updated_at
  ) VALUES (?, 'agreement_invitation', ?, 'fictional-client@example.test', 'pending', ?, ?)`);
  const now = new Date().toISOString();
  statement.run(crypto.randomUUID(), 'agreement_invite:agr_preview_a:v1', now, now);
  statement.run(crypto.randomUUID(), 'agreement_invite:agr_preview_a:v2', now, now);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM outbound_message_events').get().count, 2);
  database.close();
});
