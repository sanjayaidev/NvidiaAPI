// Single Edge Function: handles model listing + chat completions.
// Runs on Vercel's Edge Runtime (no Node APIs, no OpenAI SDK — that SDK
// depends on Node-only modules like `agentkeepalive`/`https.Agent`, which
// don't exist at the edge). We talk to NVIDIA's OpenAI-compatible endpoint
// with plain fetch, and to Upstash Redis over its REST API — both are
// HTTP-based and edge-safe.

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

export const config = {
  runtime: 'edge',
};

const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';

// Exact list of allowed models - only these will appear in the dropdown
const ALLOWED_MODELS = [
  'abacusai/dracarys-llama-3.1-70b-instruct',
  'deepseek-ai/deepseek-v4-flash',
  'deepseek-ai/deepseek-v4-pro',
  'meta/llama-3.1-70b-instruct',
  'meta/llama-3.1-8b-instruct',
  'meta/llama-3.2-11b-vision-instruct',
  'meta/llama-3.2-1b-instruct',
  'meta/llama-3.2-3b-instruct',
  'meta/llama-3.2-90b-vision-instruct',
  'meta/llama-3.3-70b-instruct',
  'meta/llama-4-maverick-17b-128e-instruct',
  'meta/llama-guard-4-12b',
  'mistralai/ministral-14b-instruct-2512',
  'mistralai/mistral-large-3-675b-instruct-2512',
  'mistralai/mistral-medium-3.5-128b',
  'mistralai/mistral-small-4-119b-2603',
  'mistralai/mixtral-8x7b-instruct-v0.1',
  'moonshotai/kimi-k2.6',
  'nvidia/llama-3.1-nemoguard-8b-content-safety',
  'nvidia/llama-3.1-nemoguard-8b-topic-control',
];

function isAllowedModel(modelId) {
  return ALLOWED_MODELS.includes(modelId);
}

// Default RPM per model if NVIDIA's panel hasn't given us a specific
// override for that model id. NVIDIA's own docs note limits "may vary by
// model" — override per-id here as you confirm real numbers from your panel.
const DEFAULT_RPM = 40;
const MODEL_RPM_OVERRIDES = {
  // 'meta/llama-3.1-70b-instruct': 40,
  // 'deepseek-ai/deepseek-r1': 20,
};

function rpmForModel(modelId) {
  return MODEL_RPM_OVERRIDES[modelId] || DEFAULT_RPM;
}

// ---- Upstash Redis-backed per-model rate limiter ----
// Lazily constructed per model id, then cached for the life of this
// (warm) edge instance. Real enforcement still goes through Redis, so
// it's accurate across multiple edge instances/regions, not just local.
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

function getLimiterForModel(modelId) {
  const r = getRedis();
  if (!r) return null;
  if (limiterCache.has(modelId)) return limiterCache.get(modelId);
  const limiter = new Ratelimit({
    redis: r,
    limiter: Ratelimit.slidingWindow(rpmForModel(modelId), '60 s'),
    prefix: 'nvchat-ratelimit',
  });
  limiterCache.set(modelId, limiter);
  return limiter;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(), ...extraHeaders },
  });
}

async function listModels(apiKey) {
  // Return only our curated list of allowed models
  // We still make the API call to verify the key works, but ignore the results
  try {
    const r = await fetch(`${NVIDIA_BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!r.ok) throw new Error(`status ${r.status}`);
    // API key is valid, return our curated list
    return ALLOWED_MODELS;
  } catch (_) {
    // Even if API call fails, return our curated list
    return ALLOWED_MODELS;
  }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    return json({ error: 'NVIDIA_API_KEY environment variable is not set' }, 500);
  }

  const url = new URL(req.url);

  // GET /api/chat?list=models  -> live, family-filtered model catalog
  if (req.method === 'GET') {
    if (url.searchParams.get('list') === 'models') {
      const models = await listModels(apiKey);
      return json({ models });
    }
    return json({ error: 'Use GET ?list=models or POST a chat request' }, 400);
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  let body;
  try {
    body = await req.json();
  } catch (_) {
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

  if (!isAllowedModel(model)) {
    return json({ error: `Model "${model}" is not in the allowed list` }, 403);
  }

  // Per-model rate limit, enforced via Upstash before we spend any NVIDIA quota.
  const limiter = getLimiterForModel(model);
  if (limiter) {
    const { success, limit, remaining, reset } = await limiter.limit(model);
    if (!success) {
      const retryAfterSec = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
      return json(
        {
          error: `Rate limit reached for model "${model}" (${limit}/min). Try again shortly.`,
          retry_after_seconds: retryAfterSec,
        },
        429,
        {
          'Retry-After': String(retryAfterSec),
          'X-RateLimit-Limit': String(limit),
          'X-RateLimit-Remaining': String(remaining),
        }
      );
    }
  }

  const formattedMessages = messages.map((m) => ({ role: m.role, content: m.content }));

  const upstreamPayload = {
    model,
    messages: formattedMessages,
    temperature,
    max_tokens,
    top_p: 1,
    stream: Boolean(stream),
  };

  let upstream;
  try {
    upstream = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(upstreamPayload),
    });
  } catch (err) {
    return json({ error: 'Failed to reach NVIDIA API', details: err.message }, 502);
  }

  if (!upstream.ok) {
    const rawText = await upstream.text();
    let details = rawText;
    try {
      details = JSON.parse(rawText);
    } catch (_) {
      // leave details as raw text if it isn't JSON
    }
    return json(
      { error: 'NVIDIA API returned an error', status: upstream.status, details },
      upstream.status
    );
  }

  // Streaming: pipe NVIDIA's SSE stream straight through to the client.
  if (upstreamPayload.stream) {
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        ...corsHeaders(),
      },
    });
  }

  // Non-streaming: pass the JSON straight through (already OpenAI-shaped).
  const data = await upstream.json();
  return json(data);
}
