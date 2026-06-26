// pages/api/auth/signup.js
//
// POST { email, password } -> creates a user, silently provisions a
// managed-tier api_keys row (never returned to the client — the
// session-authenticated chat route looks it up server-side), creates
// a session, sets the session cookie.
//
// Deliberately minimal: no email verification. The only abuse guard
// is the per-IP rate limit in lib/signupRateLimit.js.
// TRIAL RULE: Free tier accounts expire after 7 days from signup.

import { getSql } from '../../../lib/db';
import { hashPassword } from '../../../lib/password';
import { createSession, buildSessionCookieHeader } from '../../../lib/session';
import { generateApiKey, hashApiKey } from '../../../lib/apiKeyAuth';
import { checkSignupRateLimit, getClientIp } from '../../../lib/signupRateLimit';

export const config = { runtime: 'edge' };

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

// Default daily cap for self-serve signups. Separate from the CLI
// script's default (200) since self-serve users are unvetted — keep
// this conservative and raise per-account manually if someone needs more.
const SELF_SERVE_DAILY_CAP = 50;

// Trial period in days
const TRIAL_DAYS = 7;

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const ip = getClientIp(req);
  const rl = await checkSignupRateLimit(ip);
  if (!rl.ok) {
    return json(
      { error: 'Too many signups from this network. Try again later.' },
      429,
      { 'Retry-After': String(rl.retryAfterSec) }
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const email = (body?.email || '').trim().toLowerCase();
  const password = body?.password || '';

  if (!email || !email.includes('@')) {
    return json({ error: 'A valid email is required' }, 400);
  }
  if (password.length < 8) {
    return json({ error: 'Password must be at least 8 characters' }, 400);
  }

  const sql = getSql();

  // Check if another account already exists from this IP address
  const existingByIp = await sql`select id from users where ip_at_signup = ${ip}`;
  if (existingByIp.length > 0) {
    return json({ error: 'An account already exists from this IP address. Only one account per IP is allowed.' }, 409);
  }

  const existing = await sql`select id from users where email = ${email}`;
  if (existing.length > 0) {
    return json({ error: 'An account with this email already exists' }, 409);
  }

  const userId = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  
  // Calculate trial expiration date (7 days from now)
  const trialExpiresAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

  await sql`
    insert into users (id, email, password_hash, plan, ip_at_signup, trial_expires_at)
    values (${userId}, ${email}, ${passwordHash}, 'free', ${ip}, ${trialExpiresAt.toISOString()})
  `;

  // Silently provision a managed-tier key for this user. Raw key is
  // generated, hashed for storage, and then discarded from memory —
  // never sent in this response. The session-authenticated chat route
  // looks this row up by owner_user_id, not by the raw key.
  const rawKey = generateApiKey();
  const keyHash = await hashApiKey(rawKey);
  await sql`
    insert into api_keys (owner_label, key_hash, key_prefix, tier, daily_request_cap, owner_user_id)
    values (${email}, ${keyHash}, ${rawKey.slice(0, 8)}, 'managed', ${SELF_SERVE_DAILY_CAP}, ${userId})
  `;

  const userAgent = req.headers.get('user-agent') || null;
  const { token, expiresAt } = await createSession(sql, userId, { userAgent, ip });

  return json(
    { ok: true, userId, email },
    201,
    { 'Set-Cookie': buildSessionCookieHeader(token, expiresAt) }
  );
}
