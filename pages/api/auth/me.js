// pages/api/auth/me.js
//
// GET -> { signedIn: true, email } if a valid session cookie is present,
// otherwise { signedIn: false }. The public UI calls this on load to
// decide whether to show the login/signup form or the chat interface.

import { getSql } from '../../../lib/db';
import { readSessionCookie, getSessionUser } from '../../../lib/session';

export const config = { runtime: 'edge' };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

export default async function handler(req) {
  const sql = getSql();
  const token = readSessionCookie(req);
  const session = await getSessionUser(sql, token);
  if (!session) return json({ signedIn: false });

  const rows = await sql`select email from users where id = ${session.userId}`;
  return json({ signedIn: true, email: rows[0]?.email || null });
}
