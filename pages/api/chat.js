// Single Edge Function: handles model listing + chat completions.
// Runs on Vercel's Edge Runtime (no Node APIs, no OpenAI SDK — that SDK
// depends on Node-only modules like `agentkeepalive`/`https.Agent`, which
// don't exist at the edge). We talk to NVIDIA's OpenAI-compatible endpoint
// with plain fetch, to Upstash Redis over its REST API, and to Neon
// Postgres over HTTP (@neondatabase/serverless) — all three are
// fetch-based and edge-safe.
//
// PERSONAL-USE NOTE: thread/message persistence below is intentionally
// simple — everything is saved under the single 'demo-user' identity from
// lib/auth.js. That's fine for solo use. The public-facing fork (v3 arch:
// lib/registry.js, real auth, per-user isolation) is a separate build.

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { getSql } from '../../lib/db';
import { getUserId, ensureUser } from '../../lib/auth';
import { invalidateThreadCache } from '../../lib/cache';

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

// ---- thread/message persistence (Neon) ----
// Best-effort: if Neon isn't configured (DATABASE_URL missing) or any
// call here throws, we swallow the error and let the chat response go
// through anyway. Saving history should never be the reason a chat
// request fails.

async function getOrCreateThread(sql, userId, threadId, model) {
  if (threadId) {
    const rows = await sql`
      select id, user_id from threads where id = ${threadId}
    `;
    const thread = rows[0];
    if (thread && thread.user_id === userId) return thread.id;
    // threadId given but not found/owned — fall through and create a new one
  }
  const rows = await sql`
    insert into threads (user_id, tool, model, title)
    values (${userId}, 'chat', ${model}, 'New conversation')
    returning id
  `;
  return rows[0].id;
}

async function saveMessage(sql, threadId, role, content) {
  await sql`
    insert into messages (thread_id, role, content)
    values (${threadId}, ${role}, ${content})
  `;
  await sql`update threads set updated_at = now() where id = ${threadId}`;
}

async function maybeAutoTitleThread(sql, threadId, firstUserMessage) {
  // Only set a real title if the thread still has the default placeholder —
  // cheap way to avoid overwriting a title the user (or future UI) set.
  const title = firstUserMessage.slice(0, 60).trim() || 'New conversation';
  await sql`
    update threads set title = ${title}
    where id = ${threadId} and title = 'New conversation'
  `;
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
    threadId = null,
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

  // ---- persistence setup (best-effort, never blocks the chat call) ----
  let sql = null;
  let userId = null;
  let resolvedThreadId = null;
  let isFirstMessageInThread = false;

  try {
    sql = getSql();
    userId = await getUserId(req);
    await ensureUser(sql, userId);
    resolvedThreadId = await getOrCreateThread(sql, userId, threadId, model);

    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUserMessage) {
      const existing = await sql`select 1 from messages where thread_id = ${resolvedThreadId} limit 1`;
      isFirstMessageInThread = existing.length === 0;
      await saveMessage(sql, resolvedThreadId, 'user', lastUserMessage.content);
      if (isFirstMessageInThread) {
        await maybeAutoTitleThread(sql, resolvedThreadId, lastUserMessage.content);
      }
      await invalidateThreadCache(resolvedThreadId);
    }
  } catch (err) {
    console.error('chat.js: persistence setup failed, continuing without history:', err.message);
    sql = null; // disable further persistence attempts for this request
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
      upstream.status,
      resolvedThreadId ? { 'X-Thread-Id': resolvedThreadId } : {}
    );
  }

  // Streaming: pipe NVIDIA's SSE stream straight through to the client,
  // while also tee-ing it so we can accumulate the full assistant text
  // and persist it once the stream ends — without delaying the client.
  if (upstreamPayload.stream) {
    const threadIdForSave = resolvedThreadId;
    const sqlForSave = sql;

    let accumulated = '';
    const decoder = new TextDecoder();
    let sseBuffer = '';

    const passthrough = new TransformStream({
      transform(chunk, controller) {
        controller.enqueue(chunk);
        sseBuffer += decoder.decode(chunk, { stream: true });
        const lines = sseBuffer.split('\n');
        sseBuffer = lines.pop();
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const data = JSON.parse(payload);
            const delta = data.choices?.[0]?.delta?.content;
            if (delta) accumulated += delta;
          } catch (_) {
            // ignore malformed/partial chunk, doesn't affect passthrough
          }
        }
      },
      async flush() {
        if (!sqlForSave || !threadIdForSave || !accumulated) return;
        try {
          await saveMessage(sqlForSave, threadIdForSave, 'assistant', accumulated);
          await invalidateThreadCache(threadIdForSave);
        } catch (err) {
          console.error('chat.js: failed to save assistant message:', err.message);
        }
      },
    });

    const piped = upstream.body.pipeThrough(passthrough);

    return new Response(piped, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        ...(resolvedThreadId ? { 'X-Thread-Id': resolvedThreadId } : {}),
        ...corsHeaders(),
      },
    });
  }

  // Non-streaming: pass the JSON straight through (already OpenAI-shaped),
  // and persist the assistant reply if we have a thread to attach it to.
  const data = await upstream.json();

  if (sql && resolvedThreadId) {
    const replyText = data.choices?.[0]?.message?.content;
    if (replyText) {
      try {
        await saveMessage(sql, resolvedThreadId, 'assistant', replyText);
        await invalidateThreadCache(resolvedThreadId);
      } catch (err) {
        console.error('chat.js: failed to save assistant message:', err.message);
      }
    }
  }

  return json(data, 200, resolvedThreadId ? { 'X-Thread-Id': resolvedThreadId } : {});
}
