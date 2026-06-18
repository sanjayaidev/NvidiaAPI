// lib/session.js — Edge-compatible version.
//
// Original used Node's `crypto` module and Node-style `req.headers.cookie`
// string access. Everything else in this app (chat.js, v1/chat.js,
// apiKeyAuth.js) runs on the Edge runtime, where `req` is a standard
// Request object — headers are read via req.headers.get('cookie'), and
// Node's `crypto` module isn't available. This version uses Web Crypto
// instead, so signup/login/session-checks can run on Edge too.
//
// Session model unchanged: a random opaque token is the only thing in
// the cookie. It carries no information — it's a lookup key into the
// `sessions` table, which maps it to a user_id and an expiry. Revoking
// access is one DELETE, not a token blacklist or JWT expiry wait.

const SESSION_COOKIE_NAME = 'smagents_session';
const SESSION_TTL_DAYS = 30;

function toHex(bytes) {
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function generateSessionToken() {
  return toHex(crypto.getRandomValues(new Uint8Array(32)));
}

export async function createSession(sql, userId, { userAgent, ip } = {}) {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  await sql`
    insert into sessions (id, user_id, expires_at, user_agent, ip)
    values (${token}, ${userId}, ${expiresAt.toISOString()}, ${userAgent || null}, ${ip || null})
  `;

  return { token, expiresAt };
}

/**
 * @returns {Promise<{userId: string} | null>}
 */
export async function getSessionUser(sql, token) {
  if (!token) return null;
  const rows = await sql`
    select user_id, expires_at from sessions where id = ${token}
  `;
  const session = rows[0];
  if (!session) return null;
  if (new Date(session.expires_at) < new Date()) {
    await sql`delete from sessions where id = ${token}`;
    return null;
  }
  return { userId: session.user_id };
}

export async function destroySession(sql, token) {
  if (!token) return;
  await sql`delete from sessions where id = ${token}`;
}

export async function destroyAllUserSessions(sql, userId) {
  await sql`delete from sessions where user_id = ${userId}`;
}

// ---- cookie helpers (Edge: req is a standard Request, headers via .get()) ----

export function readSessionCookie(req) {
  const header = req.headers.get('cookie');
  if (!header) return null;
  const match = header.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (!match) return null;
  return match.slice(SESSION_COOKIE_NAME.length + 1);
}

// Edge Response headers don't support multiple Set-Cookie via repeated
// .set() the way Node's res.setHeader does — caller should construct
// the Response with this string directly in the headers object.
export function buildSessionCookieHeader(token, expiresAt) {
  const isProd = process.env.NODE_ENV === 'production';
  const parts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${expiresAt.toUTCString()}`,
  ];
  if (isProd) parts.push('Secure');
  return parts.join('; ');
}

export function buildClearSessionCookieHeader() {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];
  return parts.join('; ');
}

export { SESSION_COOKIE_NAME };
