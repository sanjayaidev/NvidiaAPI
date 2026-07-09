// pages/api/auth/login.js
//
// POST { email, password } -> verifies credentials, creates a new
// session, sets the session cookie. No rate limiting here (unlike
// signup) — a generous failed-login limit could be added later if
// credential-stuffing becomes a real concern, but isn't needed for v1.

import { getSql } from '../../../lib/db';
import { verifyPassword } from '../../../lib/password';
import { createSession, buildSessionCookieHeader } from '../../../lib/session';
import { getClientIp } from '../../../lib/signupRateLimit';

export const config = { runtime: 'edge' };

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const email = (body?.email || '').trim().toLowerCase();
  const password = body?.password || '';
  if (!email || !password) {
    return json({ error: 'Email and password are required' }, 400);
  }

  const sql = getSql();
  const rows = await sql`select id, password_hash, trial_expires_at from users where email = ${email}`;
  const user = rows[0];

  // Same error for "no such user" and "wrong password" — don't leak
  // which case it was, that just helps someone enumerate valid emails.
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return json({ error: 'Invalid email or password' }, 401);
  }

  // Check if trial has expired
  if (user.trial_expires_at && new Date(user.trial_expires_at) < new Date()) {
    return json({ error: 'Your trial has expired' }, 403);
  }

  const ip = getClientIp(req);
  const userAgent = req.headers.get('user-agent') || null;
  const { token, expiresAt } = await createSession(sql, user.id, { userAgent, ip });

  return json(
    { ok: true, userId: user.id, email, trialExpiresAt: user.trial_expires_at },
    200,
    { 'Set-Cookie': buildSessionCookieHeader(token, expiresAt) }
  );
}
