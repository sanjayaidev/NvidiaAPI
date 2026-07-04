// pages/api/canva/authorize.js
//
// Requires a signed-in SM Agents session (same session cookie as the
// rest of the app — lib/session.js). We stash the session's userId
// inside the signed PKCE cookie so /callback knows whose account to
// attach the Canva tokens to, without needing a DB round-trip mid-flow.

import { getSql } from '../../../lib/db';
import { readSessionCookie, getSessionUser } from '../../../lib/session';
import {
  CANVA_MCP_AUTH_URL,
  CANVA_SCOPES,
  randomVerifier,
  sha256base64url,
  signPkceCookie,
  buildPkceCookieHeader,
} from '../../../lib/canva';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const sql = getSql();
  const sessionToken = readSessionCookie(req);
  const session = await getSessionUser(sql, sessionToken);

  if (!session) {
    // Send them to sign in first, then back here.
    const url = new URL(req.url);
    return Response.redirect(`${url.origin}/chat.html?login_required=1&next=/api/canva/authorize`, 302);
  }

  const url = new URL(req.url);
  const clientId = `${url.origin}/api/canva/client-metadata.json`;
  const redirectUri = `${url.origin}/api/canva/callback`;

  const codeVerifier = randomVerifier();
  const codeChallenge = await sha256base64url(codeVerifier);
  const state = randomVerifier();

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: CANVA_SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  const cookieValue = await signPkceCookie(JSON.stringify({ state, codeVerifier, userId: session.userId }));

  return new Response(null, {
    status: 302,
    headers: {
      Location: `${CANVA_MCP_AUTH_URL}?${params.toString()}`,
      'Set-Cookie': buildPkceCookieHeader(cookieValue),
    },
  });
}
