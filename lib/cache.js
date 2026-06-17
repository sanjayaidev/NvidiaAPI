// lib/cache.js
//
// Upstash Redis is used for two DISTINCT purposes in this system —
// keeping them in separate files/concerns matters:
//
//   1. lib/ratelimit.js -> correctness (must not lose this data,
//      it's what stops you blowing through NVIDIA's free-tier RPM)
//   2. lib/cache.js (this file) -> speed only. Everything here is
//      safe to lose/expire; Postgres (lib/db.js) remains the source
//      of truth for threads/messages/jobs.
//
// Typical uses: cache the model catalog list, cache "last 20
// messages" for a thread so reopening it doesn't always hit Neon,
// cache job status so polling doesn't hammer Postgres every 2s.

import { Redis } from '@upstash/redis';

let redis = null;

function getRedis() {
  if (redis) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  redis = new Redis({ url, token });
  return redis;
}

const THREAD_CACHE_TTL_SEC = 60 * 10; // 10 min
const JOB_CACHE_TTL_SEC = 30; // jobs change fast while running, short TTL

export async function cacheThreadMessages(threadId, messages) {
  const r = getRedis();
  if (!r) return;
  await r.set(`thread:${threadId}:messages`, JSON.stringify(messages), {
    ex: THREAD_CACHE_TTL_SEC,
  });
}

export async function getCachedThreadMessages(threadId) {
  const r = getRedis();
  if (!r) return null;
  const val = await r.get(`thread:${threadId}:messages`);
  if (!val) return null;
  try {
    return typeof val === 'string' ? JSON.parse(val) : val;
  } catch {
    return null;
  }
}

export async function invalidateThreadCache(threadId) {
  const r = getRedis();
  if (!r) return;
  await r.del(`thread:${threadId}:messages`);
}

export async function cacheJobStatus(jobId, jobRow) {
  const r = getRedis();
  if (!r) return;
  await r.set(`job:${jobId}`, JSON.stringify(jobRow), { ex: JOB_CACHE_TTL_SEC });
}

export async function getCachedJobStatus(jobId) {
  const r = getRedis();
  if (!r) return null;
  const val = await r.get(`job:${jobId}`);
  if (!val) return null;
  try {
    return typeof val === 'string' ? JSON.parse(val) : val;
  } catch {
    return null;
  }
}

export async function cacheModelCatalog(catalog) {
  const r = getRedis();
  if (!r) return;
  await r.set('catalog:models', JSON.stringify(catalog), { ex: 60 * 60 }); // 1hr
}

export async function getCachedModelCatalog() {
  const r = getRedis();
  if (!r) return null;
  const val = await r.get('catalog:models');
  if (!val) return null;
  try {
    return typeof val === 'string' ? JSON.parse(val) : val;
  } catch {
    return null;
  }
}
