// lib/ratelimit.js
//
// Extracted from your original pages/api/chat.js. Same logic, now
// reusable by every tool route (chat, image, video, audio, agent) —
// not just text chat. Per-model (or per-provider) sliding-window
// limits enforced via Upstash before we spend any upstream quota.

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

let redis = null;
const limiterCache = new Map();

const DEFAULT_RPM = 40;

// Override per model/provider id as you confirm real numbers from
// each provider's dashboard (NVIDIA build.nvidia.com panel,
// Replicate plan limits, ElevenLabs plan limits, etc).
const RPM_OVERRIDES = {
  // 'meta/llama-3.1-70b-instruct': 40,
  // 'replicate:black-forest-labs/flux-1.1-pro': 10,
};

function rpmFor(key) {
  return RPM_OVERRIDES[key] || DEFAULT_RPM;
}

function getRedis() {
  if (redis) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  redis = new Redis({ url, token });
  return redis;
}

function getLimiter(key) {
  const r = getRedis();
  if (!r) return null;
  if (limiterCache.has(key)) return limiterCache.get(key);
  const limiter = new Ratelimit({
    redis: r,
    limiter: Ratelimit.slidingWindow(rpmFor(key), '60 s'),
    prefix: 'smagents-ratelimit',
  });
  limiterCache.set(key, limiter);
  return limiter;
}

/**
 * @param {string} key - usually `${provider}:${model}` or just model id
 * @returns {Promise<{ok:true} | {ok:false, retryAfterSec:number, limit:number, remaining:number}>}
 */
export async function checkRateLimit(key) {
  const limiter = getLimiter(key);
  if (!limiter) return { ok: true }; // Upstash not configured — fail open in dev
  const { success, limit, remaining, reset } = await limiter.limit(key);
  if (success) return { ok: true };
  const retryAfterSec = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
  return { ok: false, retryAfterSec, limit, remaining };
}
