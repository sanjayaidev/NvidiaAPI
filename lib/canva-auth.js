// lib/canva-auth.js
//
// Handles the Canva OAuth 2.0 + PKCE dance and stores tokens in Upstash
// Redis (same store your chat.js already uses for rate limiting).
//
// PERSONAL-USE NOTE: like chat.js, this assumes a single "demo-user"
// identity — fine for solo use. For multi-user, swap DEMO_USER_ID for
// a real per-user id from your auth layer everywhere it's used.

import { Redis } from '@upstash/redis';
import crypto from 'node:crypto';

export const DEMO_USER_ID = 'demo-user';

let redis = null;
function getRedis() {
  if (redis) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('Upstash Redis env vars are not set');
  redis = new Redis({ url, token });
  return redis;
}

function base64url(buf) {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function createPkcePair() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

// state -> { verifier, userId }, short-lived (10 min), single use
export async function saveAuthState(state, verifier, userId) {
  const r = getRedis();
  await r.set(`canva:oauth:state:${state}`, JSON.stringify({ verifier, userId }), { ex: 600 });
}

export async function consumeAuthState(state) {
  const r = getRedis();
  const raw = await r.get(`canva:oauth:state:${state}`);
  if (!raw) return null;
  await r.del(`canva:oauth:state:${state}`);
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

export async function saveCanvaTokens(userId, tokens) {
  const r = getRedis();
  await r.set(`canva:tokens:${userId}`, JSON.stringify(tokens));
}

export async function getCanvaTokens(userId) {
  const r = getRedis();
  const raw = await r.get(`canva:tokens:${userId}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

export async function refreshCanvaTokens(userId) {
  const tokens = await getCanvaTokens(userId);
  if (!tokens?.refresh_token) return null;

  const resp = await fetch('https://mcp.canva.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: process.env.CANVA_CLIENT_ID,
      client_secret: process.env.CANVA_CLIENT_SECRET,
    }),
  });

  if (!resp.ok) {
    console.error('canva-auth.js: refresh failed', await resp.text());
    return null;
  }

  const fresh = await resp.json();
  const merged = {
    ...tokens,
    ...fresh,
    expires_at: Date.now() + (fresh.expires_in || 3600) * 1000,
  };
  await saveCanvaTokens(userId, merged);
  return merged;
}

// Returns a usable access token, refreshing first if it's expired or about
// to expire. Returns null if the user has never connected Canva.
export async function getValidCanvaAccessToken(userId) {
  let tokens = await getCanvaTokens(userId);
  if (!tokens) return null;

  if (tokens.expires_at && Date.now() > tokens.expires_at - 30_000) {
    tokens = await refreshCanvaTokens(userId);
  }

  return tokens?.access_token || null;
}
