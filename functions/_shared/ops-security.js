const encoder = new TextEncoder();
const SESSION_COOKIE = '__Host-e4la_ops';

export const json = (data, status = 200, extraHeaders = {}) => new Response(JSON.stringify(data), {
  status,
  headers: securityHeaders({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0',
    ...extraHeaders,
  }),
});

export function securityHeaders(extra = {}) {
  return new Headers({
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    ...extra,
  });
}

export function requestId(request) {
  return request.headers.get('cf-ray') || crypto.randomUUID();
}

export async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function randomToken(bytes = 32) {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...data)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function parseCookie(request, name = SESSION_COOKIE) {
  const cookie = request.headers.get('Cookie') || '';
  for (const entry of cookie.split(';')) {
    const [key, ...parts] = entry.trim().split('=');
    if (key === name) return decodeURIComponent(parts.join('='));
  }
  return null;
}

export function sessionCookie(token, maxAgeSeconds) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function requireJson(request) {
  const type = request.headers.get('Content-Type') || '';
  if (!type.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'unsupported_media_type', 'Send this request as JSON.');
  }
}

export function requireTrustedOrigin(request, env) {
  const origin = request.headers.get('Origin');
  const requestOrigin = new URL(request.url).origin;
  const configured = String(env.PUBLIC_SITE_URL || '').replace(/\/$/, '');
  const allowed = new Set([requestOrigin]);
  if (configured) allowed.add(configured);
  if (!origin || !allowed.has(origin)) {
    throw new HttpError(403, 'origin_rejected', 'This request could not be verified.');
  }
}

export async function consumeRateLimit(db, key, options = {}) {
  const limit = options.limit || 8;
  const windowSeconds = options.windowSeconds || 60;
  const now = Math.floor(Date.now() / 1000);
  const bucket = await sha256(`rate:${key}`);
  const start = now - (now % windowSeconds);
  await db.prepare(`
    INSERT INTO request_rate_limits (bucket_key, window_started_at, request_count, expires_at)
    VALUES (?, ?, 1, ?)
    ON CONFLICT(bucket_key) DO UPDATE SET
      request_count = CASE WHEN window_started_at = excluded.window_started_at THEN request_count + 1 ELSE 1 END,
      window_started_at = excluded.window_started_at,
      expires_at = excluded.expires_at
  `).bind(bucket, start, start + windowSeconds * 2).run();
  const row = await db.prepare('SELECT request_count, window_started_at FROM request_rate_limits WHERE bucket_key = ?')
    .bind(bucket).first();
  if (row && row.window_started_at === start && row.request_count > limit) {
    throw new HttpError(429, 'rate_limited', 'Too many attempts. Wait a moment and try again.');
  }
}

export async function createSession(db, claims, parentSessionId = null) {
  const token = randomToken(32);
  const csrfToken = randomToken(24);
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const ttlSeconds = claims.ttlSeconds || 30 * 60;
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  await db.prepare(`
    INSERT INTO access_sessions (
      id, token_hash, csrf_hash, actor_type, actor_id, client_id, agreement_id, role,
      expires_at, rotated_from_session_id, created_at, last_seen_at,
      identity_link_id, authentication_method
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, await sha256(token), await sha256(csrfToken), claims.actorType, claims.actorId || null,
    claims.clientId || null, claims.agreementId || null, claims.role, expiresAt,
    parentSessionId, createdAt, createdAt, claims.identityLinkId || null,
    claims.authenticationMethod || null,
  ).run();
  return { id, token, csrfToken, ttlSeconds, expiresAt };
}

export async function authenticate(request, env, allowedRoles = []) {
  const token = parseCookie(request);
  if (!token) throw new HttpError(401, 'authentication_required', 'Your secure session has expired. Request a new access link.');
  const tokenHash = await sha256(token);
  const session = await env.ENROLLMENT_DB.prepare(`
    SELECT * FROM access_sessions
    WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?
  `).bind(tokenHash, new Date().toISOString()).first();
  if (!session) throw new HttpError(401, 'session_expired', 'Your secure session has expired. Request a new access link.');
  if (allowedRoles.length && !allowedRoles.includes(session.role)) {
    throw new HttpError(403, 'not_authorized', 'You do not have permission to perform this action.');
  }
  return session;
}

export async function requireCsrf(request, session) {
  const supplied = request.headers.get('X-CSRF-Token');
  if (!supplied || await sha256(supplied) !== session.csrf_hash) {
    throw new HttpError(403, 'csrf_rejected', 'Your secure session could not be verified. Refresh and try again.');
  }
}

export async function rotateSession(db, session) {
  const next = await createSession(db, {
    actorType: session.actor_type,
    actorId: session.actor_id,
    clientId: session.client_id,
    agreementId: session.agreement_id,
    role: session.role,
    identityLinkId: session.identity_link_id,
    authenticationMethod: session.authentication_method,
    ttlSeconds: session.actor_type === 'agreement_signer' ? 30 * 60 : 8 * 60 * 60,
  }, session.id);
  await db.prepare('UPDATE access_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
    .bind(new Date().toISOString(), session.id).run();
  return next;
}

export function operationalLog(env, event) {
  const allowed = {
    request_id: event.requestId || null,
    event_type: sanitizeText(event.type, 80),
    environment: sanitizeText(env.ENVIRONMENT, 20),
    agreement_id: sanitizeText(event.agreementId, 80) || null,
    client_id: sanitizeText(event.clientId, 80) || null,
    project_id: sanitizeText(event.projectId, 80) || null,
    status: sanitizeText(event.status, 60) || null,
    timestamp: new Date().toISOString(),
    error_code: sanitizeText(event.errorCode, 80) || null,
  };
  console.log(JSON.stringify(allowed));
}

export async function audit(db, event) {
  await db.prepare(`
    INSERT INTO audit_events (
      id, event_type, actor_type, actor_id, client_id, project_id, agreement_id,
      enrollment_id, related_entity_type, related_entity_id, request_id, event_data_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(), event.type, event.actorType || 'system', event.actorId || null,
    event.clientId || null, event.projectId || null, event.agreementId || null,
    event.enrollmentId || null, event.relatedType || null, event.relatedId || null,
    event.requestId || null, event.data ? JSON.stringify(event.data) : null, new Date().toISOString(),
  ).run();
}

export function sanitizeText(value, maxLength = 160) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/[\u0000-\u001F\u007F]/g, '').slice(0, maxLength);
}

export function requireFields(body, fields) {
  const missing = fields.filter((field) => !sanitizeText(body[field], 500));
  if (missing.length) {
    throw new HttpError(422, 'validation_error', 'Please complete all required fields.', { fields: missing });
  }
}

export class HttpError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function errorResponse(error, request) {
  const requestIdentifier = requestId(request);
  if (error instanceof HttpError) {
    return json({ error: { code: error.code, message: error.message, details: error.details, requestId: requestIdentifier } }, error.status);
  }
  console.error('E4LA operations request failed', requestIdentifier, error);
  return json({ error: { code: 'internal_error', message: 'Something went wrong. Please try again or contact E4LA.', requestId: requestIdentifier } }, 500);
}
