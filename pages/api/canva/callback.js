// pages/api/canva/callback.js

import { getSql } from '../../../lib/db';
import {
  CANVA_MCP_TOKEN_URL,
  verifyPkceCookie,
  readPkceCookie,
  buildClearPkceCookieHeader,
  saveCanvaConnection,
} from '../../../lib/canva';

export const config = { runtime: 'edge' };

function redirectWithStatus(origin, status) {
  return Response.redirect(`${origin}/chat.html?canva=${status}`, 302);
}

export default async function handler(req) {
  const url = new URL(req.url);
  const origin = url.origin;

  const error = url.searchParams.get('error');
  if (error) {
    return redirectWithStatus(origin, 'error');
  }

  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');
  const raw = await verifyPkceCookie(readPkceCookie(req));

  if (!raw || !code) {
    return redirectWithStatus(origin, 'error');
  }

  const { state, codeVerifier, userId } = JSON.parse(raw);
  if (returnedState !== state) {
    return redirectWithStatus(origin, 'error');
  }

  const clientId = `${origin}/api/canva/client-metadata.json`;
  const redirectUri = `${origin}/api/canva/callback`;

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });

  const tokenRes = await fetch(CANVA_MCP_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!tokenRes.ok) {
    return redirectWithStatus(origin, 'error');
  }

  const data = await tokenRes.json();
  const sql = getSql();
  const expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000);

  await saveCanvaConnection(sql, userId, {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt,
    scope: data.scope,
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location: `${origin}/chat.html?canva=connected`,
      'Set-Cookie': buildClearPkceCookieHeader(),
    },
  });
}
