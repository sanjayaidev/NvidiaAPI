// lib/session.js
//
// Node-runtime only (uses crypto.randomBytes via Node's crypto module
// and bcryptjs, neither of which work on Edge). Routes that import
// this must NOT set `runtime: 'edge'` — use the Next.js default.
//
// Session model: a random opaque token is the only thing stored in
// the cookie. The token itself carries no information — it's just a
// lookup key into the `sessions` table, which maps it to a user_id
// and an expiry. This means revoking access (logout, "log out all
// devices", suspending an account) is one DELETE, not a token
// blacklist or waiting for a JWT to expire.

import crypto from 'crypto';

const SESSION_COOKIE_NAME = 'smagents_session';
const SESSION_TTL_DAYS = 30;

export function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
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
    // expired — clean up lazily rather than running a cron for this
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

// ---- cookie helpers ----
// Minimal manual parsing/serialization so we don't pull in a cookie
// library for two operations. `req` here is the standard Node
// IncomingMessage (pages/api routes, not Edge).

export function readSessionCookie(req) {
  const header = req.headers.cookie;
  if (!header) return null;
  const match = header.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (!match) return null;
  return match.slice(SESSION_COOKIE_NAME.length + 1);
}

export function setSessionCookie(res, token, expiresAt) {
  const isProd = process.env.NODE_ENV === 'production';
  const parts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${expiresAt.toUTCString()}`,
  ];
  if (isProd) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res) {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];
  res.setHeader('Set-Cookie', parts.join('; '));
}

export { SESSION_COOKIE_NAME };
