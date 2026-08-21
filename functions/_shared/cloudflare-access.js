import { HttpError, sanitizeText, sha256 } from './ops-security.js';

const keyCache = new Map();
const CACHE_MS = 5 * 60 * 1000;

export async function verifyCloudflareAccess(request, env, audienceVariable) {
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) throw new HttpError(401, 'identity_required', 'Sign in with your authorized E4LA email to continue.');
  const teamDomain = normalizeTeamDomain(env.ACCESS_TEAM_DOMAIN);
  const audience = String(env[audienceVariable] || '').trim();
  if (!audience) throw new HttpError(503, 'identity_provider_not_configured', 'Server-backed identity is not configured for this surface.');

  const parts = token.split('.');
  if (parts.length !== 3) throw new HttpError(401, 'identity_invalid', 'Your identity session could not be verified.');
  const header = decodeJson(parts[0]);
  const claims = decodeJson(parts[1]);
  if (header.alg !== 'RS256' || !header.kid) throw new HttpError(401, 'identity_invalid', 'Your identity session could not be verified.');

  const key = await getVerificationKey(teamDomain, header.kid);
  const valid = await crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' }, key, base64UrlBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!valid) throw new HttpError(401, 'identity_invalid', 'Your identity session could not be verified.');

  const now = Math.floor(Date.now() / 1000);
  const issuer = `${teamDomain}/`;
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== issuer || !audiences.includes(audience) || Number(claims.exp) <= now - 30 || Number(claims.nbf || 0) > now + 30) {
    throw new HttpError(401, 'identity_expired', 'Your identity session has expired. Sign in again.');
  }
  const email = sanitizeText(claims.email, 254).toLowerCase();
  const subject = sanitizeText(claims.sub, 300);
  if (!email || !subject || !/^\S+@\S+\.\S+$/.test(email)) {
    throw new HttpError(401, 'identity_invalid', 'Your identity session could not be verified.');
  }
  return { email, subjectHash: await sha256(`${teamDomain}:${subject}`), expiresAt: claims.exp };
}

async function getVerificationKey(teamDomain, kid) {
  const cached = keyCache.get(teamDomain);
  let keys = cached?.expiresAt > Date.now() ? cached.keys : null;
  if (!keys) {
    const response = await fetch(`${teamDomain}/cdn-cgi/access/certs`, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new HttpError(503, 'identity_provider_unavailable', 'E4LA identity verification is temporarily unavailable.');
    const payload = await response.json();
    keys = Array.isArray(payload.keys) ? payload.keys : [];
    keyCache.set(teamDomain, { keys, expiresAt: Date.now() + CACHE_MS });
  }
  const jwk = keys.find((candidate) => candidate.kid === kid && candidate.kty === 'RSA');
  if (!jwk) throw new HttpError(401, 'identity_invalid', 'Your identity session could not be verified.');
  return crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
}

function normalizeTeamDomain(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash) throw new Error();
    return url.origin;
  } catch {
    throw new HttpError(503, 'identity_provider_not_configured', 'E4LA identity verification is not configured.');
  }
}

function decodeJson(value) {
  try { return JSON.parse(new TextDecoder().decode(base64UrlBytes(value))); }
  catch { throw new HttpError(401, 'identity_invalid', 'Your identity session could not be verified.'); }
}

function base64UrlBytes(value) {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
