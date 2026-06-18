// pages/api/auth/logout.js

import { getSql } from '../../../lib/db';
import { readSessionCookie, destroySession, buildClearSessionCookieHeader } from '../../../lib/session';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const sql = getSql();
  const token = readSessionCookie(req);
  await destroySession(sql, token);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': buildClearSessionCookieHeader() },
  });
}
