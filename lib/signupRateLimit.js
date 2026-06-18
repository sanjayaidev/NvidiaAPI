// lib/signupRateLimit.js
//
// Signup has no email verification, so this is the only real guard
// against someone scripting account creation in a loop. Deliberately
// generous (a real person signing up twice from one IP/network — e.g.
// shared office wifi — shouldn't get blocked) but tight enough to stop
// a bot loop.

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

let redis = null;
let limiter = null;

const SIGNUPS_PER_IP_PER_DAY = 5;

function getRedis() {
  if (redis) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  redis = new Redis({ url, token });
  return redis;
}

function getLimiter() {
  const r = getRedis();
  if (!r) return null;
  if (limiter) return limiter;
  limiter = new Ratelimit({
    redis: r,
    limiter: Ratelimit.slidingWindow(SIGNUPS_PER_IP_PER_DAY, '1 d'),
    prefix: 'smagents-signup-ratelimit',
  });
  return limiter;
}

// Vercel sets x-forwarded-for on Edge functions; fall back to a constant
// if it's ever missing (e.g. local dev) so this never throws.
export function getClientIp(req) {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return 'unknown';
}

/**
 * @returns {Promise<{ok:true} | {ok:false, retryAfterSec:number}>}
 */
export async function checkSignupRateLimit(ip) {
  const l = getLimiter();
  if (!l) return { ok: true }; // Upstash not configured — fail open in dev
  const { success, reset } = await l.limit(ip);
  if (success) return { ok: true };
  const retryAfterSec = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
  return { ok: false, retryAfterSec };
}
