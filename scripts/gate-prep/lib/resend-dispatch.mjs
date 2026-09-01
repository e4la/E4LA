// Resend dispatch layer for E4LA Client Operations - PREVIEW ONLY.
//
// This module is importable, not a CLI script. It exists so the dispatch code
// path is fully built, tested, and ready to drop into a Cloudflare Pages
// Function unchanged the moment Cloudflare Access + Stripe gates pass and a
// real send is deliberately approved. As of writing, nothing in the live
// application calls this file.
//
// Hard safety properties this file guarantees:
//   1. Refuses to run outside env.ENVIRONMENT === 'preview' (fail closed).
//   2. Refuses to send to any recipient not on RESEND_PREVIEW_ALLOWLIST.
//   3. Never calls the real Resend network endpoint unless the caller's
//      process has SEND_FOR_REAL=1 set. Default behavior stops just short of
//      the fetch() call and records the attempt as 'suppressed'.
//   4. Uses outbound_message_events.idempotency_key (UNIQUE) as the single
//      source of truth for "have I already sent this" - it does not invent a
//      second dedup mechanism.
//
// Do not import Resend SDKs or add network code to functions/_shared/email-templates.js.
// Rendering stays inert there; delivery lives only here.

import { renderOperationsEmail } from '../../../functions/_shared/email-templates.js';
import { HttpError } from '../../../functions/_shared/ops-security.js';
import { assertAllowlistedRecipient, redact, safeLog } from './guardrails.mjs';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/**
 * Dispatch one Client Operations transactional email through the preview
 * Resend dispatch layer.
 *
 * @param {object} env - Cloudflare Pages Function-shaped environment. Must
 *   provide RESEND_PREVIEW_API_KEY, RESEND_PREVIEW_SENDER,
 *   RESEND_PREVIEW_ALLOWLIST (comma-separated emails), ENVIRONMENT, and a
 *   D1-shaped ENROLLMENT_DB (`.prepare(sql).bind(...).first()/.run()`).
 * @param {object} params
 * @param {string} params.type - one of the six renderOperationsEmail types.
 * @param {object} params.input - template input passed through to
 *   renderOperationsEmail unchanged.
 * @param {string} params.idempotencyKey - caller-supplied, must be unique per
 *   logical send attempt (e.g. `agreement_invite:agr_123:v1`).
 * @param {string} [params.clientId]
 * @param {string} [params.agreementId]
 * @param {string} [params.enrollmentId]
 * @param {string} params.recipientEmail - must be present on
 *   RESEND_PREVIEW_ALLOWLIST or this throws before anything else happens.
 * @returns {Promise<{status: 'sent'|'suppressed'|'duplicate_sent', messageEventId: string, providerMessageId: string|null}>}
 */
export async function dispatchOperationsEmail(env, {
  type,
  input,
  idempotencyKey,
  clientId = null,
  agreementId = null,
  enrollmentId = null,
  recipientEmail,
} = {}) {
  assertPreviewEnvironment(env);

  if (!idempotencyKey || typeof idempotencyKey !== 'string') {
    throw new HttpError(400, 'idempotency_key_required', 'dispatchOperationsEmail requires a non-empty idempotencyKey.');
  }
  if (!env.ENROLLMENT_DB) {
    throw new HttpError(503, 'database_not_configured', 'The Client Operations database is not configured.');
  }

  const allowlist = parseAllowlist(env.RESEND_PREVIEW_ALLOWLIST);
  assertAllowlistedRecipient(recipientEmail, allowlist);
  const normalizedRecipient = String(recipientEmail).trim().toLowerCase();

  // Render first (inert, no network/DB side effects) so a bad template type
  // fails before we touch outbound_message_events at all.
  const rendered = renderOperationsEmail(type, input);

  const claim = await claimIdempotencyRow(env.ENROLLMENT_DB, {
    idempotencyKey, type, clientId, agreementId, enrollmentId, recipientEmail: normalizedRecipient,
  });

  if (claim.alreadySent) {
    safeLog('[resend-dispatch] duplicate suppressed - already sent', idempotencyKey);
    return { status: 'duplicate_sent', messageEventId: claim.id, providerMessageId: claim.providerMessageId };
  }

  const sendForReal = process.env.SEND_FOR_REAL === '1';

  safeLog('[resend-dispatch] template', type);
  safeLog('[resend-dispatch] subject', rendered.subject);
  safeLog('[resend-dispatch] recipient', redact(normalizedRecipient));
  safeLog('[resend-dispatch] SEND_FOR_REAL', sendForReal);

  if (!sendForReal) {
    await markSuppressed(env.ENROLLMENT_DB, claim.id);
    safeLog('[resend-dispatch] result', 'suppressed - no network call made (SEND_FOR_REAL is not set to 1)');
    return { status: 'suppressed', messageEventId: claim.id, providerMessageId: null };
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_PREVIEW_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.RESEND_PREVIEW_SENDER,
        to: recipientEmail,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      }),
    });

    let responseBody = {};
    try { responseBody = await response.json(); } catch { /* non-JSON error body is fine */ }

    if (!response.ok) {
      const errorCode = `resend_http_${response.status}`;
      await markFailed(env.ENROLLMENT_DB, claim.id, errorCode);
      throw new HttpError(502, errorCode, `Resend delivery failed (${response.status}): ${responseBody.message || 'Unknown error'}`);
    }

    await markSent(env.ENROLLMENT_DB, claim.id, responseBody.id || null);
    safeLog('[resend-dispatch] result', 'sent');
    return { status: 'sent', messageEventId: claim.id, providerMessageId: responseBody.id || null };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    await markFailed(env.ENROLLMENT_DB, claim.id, 'resend_network_error');
    throw error;
  }
}

function assertPreviewEnvironment(env) {
  const environment = String(env && env.ENVIRONMENT || '').trim().toLowerCase();
  if (environment !== 'preview') {
    throw new HttpError(
      503,
      'environment_not_configured',
      'resend-dispatch only operates with env.ENVIRONMENT === "preview". Refusing to run.',
    );
  }
}

function parseAllowlist(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

// Claims (or discovers an existing claim on) the idempotency row for this
// send attempt. This is the airtight dedup guarantee: the INSERT either
// succeeds (this is a brand-new attempt) or fails on the UNIQUE constraint,
// in which case we look at the existing row's status to decide what to do.
async function claimIdempotencyRow(db, { idempotencyKey, type, clientId, agreementId, enrollmentId, recipientEmail }) {
  const nowIso = new Date().toISOString();
  const id = cryptoRandomId();
  try {
    await db.prepare(`
      INSERT INTO outbound_message_events (
        id, message_type, idempotency_key, client_id, agreement_id, enrollment_id,
        recipient_email_normalized, status, attempts, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)
    `).bind(id, type, idempotencyKey, clientId, agreementId, enrollmentId, recipientEmail, nowIso, nowIso).run();
    return { id, alreadySent: false, providerMessageId: null };
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
  }

  const existing = await db.prepare(`
    SELECT id, status, provider_message_id FROM outbound_message_events WHERE idempotency_key = ?
  `).bind(idempotencyKey).first();

  if (!existing) {
    // Extremely unlikely race (row deleted between the failed insert and this
    // lookup) - surface it rather than silently re-inserting a second row.
    throw new HttpError(500, 'idempotency_row_missing', 'Idempotency key conflicted but the existing row could not be found.');
  }

  if (existing.status === 'sent') {
    return { id: existing.id, alreadySent: true, providerMessageId: existing.provider_message_id || null };
  }

  // 'pending' or 'failed' - a legitimate retry. Reuse this row rather than
  // inserting a second one for the same idempotency key.
  await db.prepare(`
    UPDATE outbound_message_events SET status = 'pending', updated_at = ? WHERE id = ?
  `).bind(nowIso, existing.id).run();
  return { id: existing.id, alreadySent: false, providerMessageId: existing.provider_message_id || null };
}

function isUniqueConstraintError(error) {
  const message = String(error && error.message || '');
  return /UNIQUE constraint failed/i.test(message) || error?.code === 'SQLITE_CONSTRAINT_UNIQUE' || error?.code === 'SQLITE_CONSTRAINT';
}

async function markSuppressed(db, id) {
  const nowIso = new Date().toISOString();
  await db.prepare(`
    UPDATE outbound_message_events SET status = 'suppressed', updated_at = ? WHERE id = ?
  `).bind(nowIso, id).run();
}

async function markSent(db, id, providerMessageId) {
  const nowIso = new Date().toISOString();
  await db.prepare(`
    UPDATE outbound_message_events
    SET status = 'sent', sent_at = ?, updated_at = ?, provider_message_id = ?
    WHERE id = ?
  `).bind(nowIso, nowIso, providerMessageId, id).run();
}

async function markFailed(db, id, errorCode) {
  const nowIso = new Date().toISOString();
  await db.prepare(`
    UPDATE outbound_message_events
    SET status = 'failed', updated_at = ?, last_error_code = ?, attempts = attempts + 1
    WHERE id = ?
  `).bind(nowIso, errorCode, id).run();
}

function cryptoRandomId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  // Fallback for older Node runtimes without a global crypto.randomUUID.
  return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}
