// lib/canva.js
//
// Canva MCP integration via CIMD (Client ID Metadata Document) — see
// pages/api/canva/client-metadata.json.js for the doc itself. No
// Developer Portal app, no client_secret: this is a public OAuth client
// authenticated with PKCE only, same as lib/googleDrive.js is the
// analogous wrapper for Drive, this file is it for Canva.
//
// Tokens are stored per-user in canva_connections (migrations/003_canva.sql),
// keyed by the SAME user_id your session cookie resolves to
// (lib/session.js), not a fixed demo id — every user connects their own
// Canva account.

const CANVA_MCP_AUTH_URL = 'https://mcp.canva.com/authorize';
const CANVA_MCP_TOKEN_URL = 'https://mcp.canva.com/token';
const CANVA_MCP_ENDPOINT = 'https://mcp.canva.com/mcp';

export const CANVA_SCOPES = [
  'design:content:read',
  'design:content:write',
  'design:permission:read',
  'design:permission:write',
  'asset:read',
  'asset:write',
].join(' ');

// ---- PKCE / CIMD helpers (Edge-compatible, Web Crypto — same style as lib/session.js) ----

function base64url(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomVerifier() {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function sha256base64url(input) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return base64url(new Uint8Array(digest));
}

// Reuses COOKIE_SECRET-style HMAC signing to protect the short-lived
// PKCE cookie between /authorize and /callback, same pattern as the
// standalone Supabase test harness — just kept here so it lives beside
// everything else Canva-related.
async function hmac(payload, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return base64url(new Uint8Array(sig));
}

export async function signPkceCookie(value) {
  const secret = process.env.CANVA_COOKIE_SECRET;
  if (!secret) throw new Error('CANVA_COOKIE_SECRET environment variable is not set');
  return `${value}.${await hmac(value, secret)}`;
}

export async function verifyPkceCookie(signed) {
  if (!signed) return null;
  const secret = process.env.CANVA_COOKIE_SECRET;
  if (!secret) return null;
  const idx = signed.lastIndexOf('.');
  if (idx === -1) return null;
  const value = signed.slice(0, idx);
  const sig = signed.slice(idx + 1);
  const expected = await hmac(value, secret);
  return sig === expected ? value : null;
}

const PKCE_COOKIE_NAME = 'canva_pkce';

export function readPkceCookie(req) {
  const header = req.headers.get('cookie');
  if (!header) return null;
  const match = header.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${PKCE_COOKIE_NAME}=`));
  return match ? decodeURIComponent(match.slice(PKCE_COOKIE_NAME.length + 1)) : null;
}

export function buildPkceCookieHeader(signedValue) {
  const isProd = process.env.NODE_ENV === 'production';
  const parts = [
    `${PKCE_COOKIE_NAME}=${encodeURIComponent(signedValue)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=600',
  ];
  if (isProd) parts.push('Secure');
  return parts.join('; ');
}

export function buildClearPkceCookieHeader() {
  return `${PKCE_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

// ---- OAuth endpoints ----

export { CANVA_MCP_AUTH_URL, CANVA_MCP_TOKEN_URL, CANVA_MCP_ENDPOINT };

// ---- token storage ----

export async function getCanvaConnection(sql, userId) {
  const rows = await sql`
    select access_token, refresh_token, expires_at, scope
    from canva_connections
    where user_id = ${userId}
  `;
  return rows[0] || null;
}

export async function saveCanvaConnection(sql, userId, { accessToken, refreshToken, expiresAt, scope }) {
  await sql`
    insert into canva_connections (user_id, access_token, refresh_token, expires_at, scope)
    values (${userId}, ${accessToken}, ${refreshToken || null}, ${expiresAt.toISOString()}, ${scope || null})
    on conflict (user_id) do update set
      access_token = excluded.access_token,
      refresh_token = coalesce(excluded.refresh_token, canva_connections.refresh_token),
      expires_at = excluded.expires_at,
      scope = excluded.scope,
      updated_at = now()
  `;
}

export async function deleteCanvaConnection(sql, userId) {
  await sql`delete from canva_connections where user_id = ${userId}`;
}

// Refreshes if the token is within 60s of expiry. Returns a valid access
// token or throws — callers (pages/api/me/canva.js) should catch and
// surface "reconnect Canva" to the user rather than a raw 401.
export async function getValidAccessToken(sql, userId) {
  const conn = await getCanvaConnection(sql, userId);
  if (!conn) {
    const err = new Error('No Canva connection for this user');
    err.code = 'NOT_CONNECTED';
    throw err;
  }

  const expiresInMs = new Date(conn.expires_at).getTime() - Date.now();
  if (expiresInMs > 60_000) {
    return conn.access_token;
  }

  if (!conn.refresh_token) {
    const err = new Error('Canva token expired and no refresh_token stored — user must reconnect');
    err.code = 'NEEDS_RECONNECT';
    throw err;
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: conn.refresh_token,
  });

  const res = await fetch(CANVA_MCP_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Canva token refresh failed: ${res.status} ${text}`);
    err.code = 'NEEDS_RECONNECT';
    throw err;
  }

  const data = await res.json();
  const expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000);
  await saveCanvaConnection(sql, userId, {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || conn.refresh_token,
    expiresAt,
    scope: data.scope || conn.scope,
  });

  return data.access_token;
}

// ---- MCP JSON-RPC call ----

let rpcId = 0;

export async function callCanvaMcpTool(accessToken, toolName, args = {}) {
  rpcId += 1;
  const res = await fetch(CANVA_MCP_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: rpcId,
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    }),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    const err = new Error(data.error?.message || `Canva MCP call failed: ${res.status}`);
    err.status = res.status;
    err.details = data.error || data;
    throw err;
  }
  return data.result;
}
