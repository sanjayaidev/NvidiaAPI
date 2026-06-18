// pages/api/me/chat.js
//
// Session-authenticated counterpart to pages/api/v1/chat.js. The public
// UI calls THIS route (cookie auth), not v1/chat.js (bearer auth) —
// the user's api_keys row is looked up server-side by their session's
// userId, and its raw key is never generated or shown to them; only
// the CLI script (scripts/create-api-key.js) and signup.js ever see a
// raw key, and only at creation time.
//
// Reuses the exact same per-key rate limit + daily cap + model
// allowlist logic as v1/chat.js, just with a different auth source.

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { getSql } from '../../../lib/db';
import { readSessionCookie, getSessionUser } from '../../../lib/session';
import { checkAndIncrementDailyCap } from '../../../lib/apiKeyAuth';
import { isAllowedModel } from '../../../lib/registry';

export const config = { runtime: 'edge' };

const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';
const DEFAULT_RPM = 40;

let redis = null;
const limiterCache = new Map();

function getRedis() {
  if (redis) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  redis = new Redis({ url, token });
  return redis;
}

function getLimiterForKey(apiKeyId, model, rpm) {
  const r = getRedis();
  if (!r) return null;
  const cacheKey = `${apiKeyId}:${model}`;
  if (limiterCache.has(cacheKey)) return limiterCache.get(cacheKey);
  const limiter = new Ratelimit({
    redis: r,
    limiter: Ratelimit.slidingWindow(rpm, '60 s'),
    prefix: 'smagents-me-ratelimit',
  });
  limiterCache.set(cacheKey, limiter);
  return limiter;
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

async function getOwnApiKeyRow(sql, userId) {
  const rows = await sql`
    select id, allowed_models, daily_request_cap, rpm_override, active
    from api_keys
    where owner_user_id = ${userId} and tier = 'managed'
    order by created_at asc
    limit 1
  `;
  return rows[0] || null;
}

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const sql = getSql();
  const token = readSessionCookie(req);
  const session = await getSessionUser(sql, token);
  if (!session) {
    return json({ error: 'Not signed in' }, 401);
  }

  const keyRow = await getOwnApiKeyRow(sql, session.userId);
  if (!keyRow || !keyRow.active) {
    return json({ error: 'No active API key for this account — contact support' }, 403);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const {
    messages,
    model = 'meta/llama-3.1-70b-instruct',
    stream = false,
    temperature = 0.7,
    max_tokens = 2048,
  } = body || {};

  if (!messages || !Array.isArray(messages)) {
    return json({ error: 'Messages array is required' }, 400);
  }

  const allowedModels = keyRow.allowed_models || [];
  const modelAllowedForKey = allowedModels.length === 0 || allowedModels.includes(model);
  if (!isAllowedModel(model) || !modelAllowedForKey) {
    return json({ error: `Model "${model}" is not available on your account` }, 403);
  }

  const rpm = keyRow.rpm_override || DEFAULT_RPM;
  const limiter = getLimiterForKey(keyRow.id, model, rpm);
  if (limiter) {
    const { success, limit, remaining, reset } = await limiter.limit(`${keyRow.id}:${model}`);
    if (!success) {
      const retryAfterSec = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
      return json(
        { error: `Rate limit reached (${limit}/min). Try again shortly.`, retry_after_seconds: retryAfterSec },
        429,
        { 'Retry-After': String(retryAfterSec) }
      );
    }
  }

  const capCheck = await checkAndIncrementDailyCap(sql, keyRow.id, keyRow.daily_request_cap);
  if (!capCheck.ok) {
    return json({ error: `Daily request cap reached (${capCheck.cap}/day).` }, 429);
  }

  const apiKey = process.env.NVIDIA_API_KEY; // public UI is always managed-tier — your key, capped
  const upstreamPayload = {
    model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    temperature,
    max_tokens,
    top_p: 1,
    stream: Boolean(stream),
  };

  let upstream;
  try {
    upstream = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(upstreamPayload),
    });
  } catch (err) {
    return json({ error: 'Failed to reach NVIDIA API', details: err.message }, 502);
  }

  if (!upstream.ok) {
    const rawText = await upstream.text();
    let details = rawText;
    try { details = JSON.parse(rawText); } catch {}
    return json({ error: 'NVIDIA API returned an error', status: upstream.status, details }, upstream.status);
  }

  if (upstreamPayload.stream) {
    return new Response(upstream.body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
  }

  const data = await upstream.json();
  return json(data);
}
