// pages/api/image.js
//
// Edge function for image generation. Supports:
//   - Alibaba DashScope (qwen-image / wanx)   -> DASHSCOPE_API_KEY
//   - Cloudflare Workers AI (flux-1-schnell)  -> CF_ACCOUNT_ID + CF_WORKERS_AI_TOKEN
//   - Transloadit (flux-1.1-pro-ultra etc.)   -> TRANSLOADIT_AUTH_KEY + TRANSLOADIT_AUTH_SECRET
//
// POST body:
//   {
//     model: string,
//     prompt: string,
//     negative_prompt?: string,   // dashscope + transloadit
//     size?: string,              // dashscope: "1024*1024"
//     aspect_ratio?: string,      // transloadit: "3:4", cloudflare: ignored (use width/height)
//     width?: number,             // cloudflare
//     height?: number,            // cloudflare
//     watermark?: boolean,        // dashscope
//     prompt_extend?: boolean,    // dashscope
//     threadId?: string,
//   }

import { getSql } from '../../lib/db';
import { getUserId, ensureUser } from '../../lib/auth';
import { invalidateThreadCache } from '../../lib/cache';

export const config = { runtime: 'edge' };

// ── Model registry ────────────────────────────────────────────────────────────
const IMAGE_MODELS = {
  // Alibaba DashScope
  'qwen-image-2.0-pro':    { provider: 'dashscope' },
  'qwen-image-2.0':        { provider: 'dashscope' },
  'wanx2.1-t2i-turbo':    { provider: 'dashscope' },
  'wanx2.1-t2i-plus':     { provider: 'dashscope' },
  'wanx2.0-t2i-turbo':    { provider: 'dashscope' },

  // Cloudflare Workers AI
  '@cf/black-forest-labs/flux-1-schnell': { provider: 'cloudflare' },
  '@cf/stabilityai/stable-diffusion-xl-base-1.0': { provider: 'cloudflare' },
  '@cf/lykon/dreamshaper-8-lcm':          { provider: 'cloudflare' },

  // Transloadit
  'flux-1.1-pro-ultra':   { provider: 'transloadit' },
  'flux-1.1-pro':         { provider: 'transloadit' },
  'flux-1-schnell':       { provider: 'transloadit' },
  'stable-diffusion-3.5-large': { provider: 'transloadit' },
  'recraft-v3':           { provider: 'transloadit' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
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

// ── Persistence ───────────────────────────────────────────────────────────────
async function getOrCreateThread(sql, userId, threadId, model) {
  if (threadId) {
    const rows = await sql`select id, user_id from threads where id = ${threadId}`;
    const thread = rows[0];
    if (thread && thread.user_id === userId) return thread.id;
  }
  const rows = await sql`
    insert into threads (user_id, tool, model, title)
    values (${userId}, 'image', ${model}, 'New image')
    returning id
  `;
  return rows[0].id;
}

async function saveMessage(sql, threadId, role, content) {
  await sql`insert into messages (thread_id, role, content) values (${threadId}, ${role}, ${content})`;
  await sql`update threads set updated_at = now() where id = ${threadId}`;
}

async function maybeAutoTitle(sql, threadId, prompt) {
  const title = prompt.slice(0, 60).trim() || 'Image generation';
  await sql`update threads set title = ${title} where id = ${threadId} and title = 'New image'`;
}

// ── DashScope handler ─────────────────────────────────────────────────────────
async function handleDashscope(body, resolvedThreadId, sql) {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) return json({ error: 'DASHSCOPE_API_KEY is not set' }, 500);

  const {
    model,
    prompt,
    negative_prompt = '',
    size = '1024*1024',
    watermark = false,
    prompt_extend = true,
    n = 1,
  } = body;

  const isQwenImage = model.startsWith('qwen-image');

  let upstreamUrl, upstreamBody, extraHeaders = {};

  if (isQwenImage) {
    upstreamUrl = 'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
    upstreamBody = {
      model,
      input: { messages: [{ role: 'user', content: [{ text: prompt }] }] },
      parameters: { negative_prompt, prompt_extend, watermark, size, n },
    };
  } else {
    // wanx — async task
    upstreamUrl = 'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis';
    upstreamBody = {
      model,
      input: { prompt, negative_prompt },
      parameters: { size, n, watermark, prompt_extend },
    };
    extraHeaders = { 'X-DashScope-Async': 'enable' };
  }

  const upstream = await fetch(upstreamUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, ...extraHeaders },
    body: JSON.stringify(upstreamBody),
  });

  const raw = await upstream.json();
  if (!upstream.ok) return json({ error: 'DashScope API error', details: raw }, upstream.status);

  // wanx async
  if (!isQwenImage) {
    const taskId = raw.output?.task_id;
    if (!taskId) return json({ error: 'DashScope returned no task_id', details: raw }, 502);
    return json({
      status: 'pending',
      task_id: taskId,
      message: 'Poll GET /api/image?task_id=<task_id>',
      provider: 'dashscope',
      model,
    }, 202, resolvedThreadId ? { 'X-Thread-Id': resolvedThreadId } : {});
  }

  // qwen-image sync
  const choices = raw.output?.choices || [];
  const images = [];
  for (const choice of choices) {
    const content = choice.message?.content;
    if (!content) continue;
    // Handle both string and array content formats
    if (Array.isArray(content)) {
      for (const part of content) {
        if (part.image_url) images.push({ url: part.image_url });
      }
    } else if (typeof content === 'string' && content.startsWith('http')) {
      // Some models return image URL directly as string
      images.push({ url: content });
    }
  }
  if (!images.length) {
    console.error('DashScope response:', JSON.stringify(raw, null, 2));
    return json({ error: 'DashScope returned no images', details: raw }, 502);
  }

  if (sql && resolvedThreadId) {
    try {
      await saveMessage(sql, resolvedThreadId, 'assistant',
        JSON.stringify(images.map((img) => ({ type: 'image', url: img.url }))));
      await invalidateThreadCache(resolvedThreadId);
    } catch (err) {
      console.error('image.js: dashscope save failed:', err.message);
    }
  }

  return json({ images, model, provider: 'dashscope', usage: raw.usage || null }, 200,
    resolvedThreadId ? { 'X-Thread-Id': resolvedThreadId } : {});
}

// ── Cloudflare Workers AI handler ─────────────────────────────────────────────
// Returns base64 image directly — synchronous, no polling needed.
async function handleCloudflare(body, resolvedThreadId, sql) {
  const accountId = process.env.CF_ACCOUNT_ID;
  const apiToken = process.env.CF_WORKERS_AI_TOKEN;
  if (!accountId) return json({ error: 'CF_ACCOUNT_ID is not set' }, 500);
  if (!apiToken)  return json({ error: 'CF_WORKERS_AI_TOKEN is not set' }, 500);

  const {
    model,
    prompt,
    width = 1024,
    height = 1024,
  } = body;

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;

  const upstream = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiToken}`,
    },
    body: JSON.stringify({ prompt, num_steps: 4, width, height }),
  });

  if (!upstream.ok) {
    let details;
    try { details = await upstream.json(); } catch { details = await upstream.text(); }
    const errMsgs = {
      401: 'Unauthorised — check CF_WORKERS_AI_TOKEN',
      403: 'Forbidden — token may lack Workers AI permissions',
      404: 'Account not found — check CF_ACCOUNT_ID',
      429: 'Rate limit — 100,000 req/day free tier exceeded',
    };
    return json({
      error: errMsgs[upstream.status] || `Cloudflare API error ${upstream.status}`,
      details,
    }, upstream.status);
  }

  const data = await upstream.json();
  if (data?.errors?.length) {
    return json({ error: data.errors[0]?.message || 'Cloudflare API error', details: data }, 502);
  }

  const b64 = data?.result?.image;
  if (!b64) return json({ error: 'No image data in Cloudflare response', details: data }, 502);

  const imageDataUrl = `data:image/jpeg;base64,${b64}`;

  if (sql && resolvedThreadId) {
    try {
      await saveMessage(sql, resolvedThreadId, 'assistant',
        JSON.stringify([{ type: 'image', url: imageDataUrl }]));
      await invalidateThreadCache(resolvedThreadId);
    } catch (err) {
      console.error('image.js: cloudflare save failed:', err.message);
    }
  }

  return json({ images: [{ b64_json: b64, url: imageDataUrl }], model, provider: 'cloudflare' }, 200,
    resolvedThreadId ? { 'X-Thread-Id': resolvedThreadId } : {});
}

// ── Transloadit handler ───────────────────────────────────────────────────────
// Transloadit is async: create an assembly, poll until ASSEMBLY_COMPLETED.
// Uses the /image/generate robot directly (no template needed).

function expiryString() {
  const d = new Date(Date.now() + 1000 * 60 * 60);
  return d.toISOString().replace(/\.\d{3}Z$/, '+00:00');
}

async function signTransloaditParams(params) {
  const authKey = process.env.TRANSLOADIT_AUTH_KEY;
  const authSecret = process.env.TRANSLOADIT_AUTH_SECRET;
  if (!authKey || !authSecret) throw new Error('TRANSLOADIT_AUTH_KEY / TRANSLOADIT_AUTH_SECRET not set');

  const paramsWithAuth = { auth: { key: authKey, expires: expiryString() }, ...params };
  const paramsJson = JSON.stringify(paramsWithAuth);

  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw', enc.encode(authSecret),
    { name: 'HMAC', hash: 'SHA-1' },
    false, ['sign']
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(paramsJson));
  const signature = Array.from(new Uint8Array(sigBuffer))
    .map((b) => b.toString(16).padStart(2, '0')).join('');

  return { paramsJson, signature };
}

async function handleTransloadit(body, resolvedThreadId, sql) {
  const { model, prompt, negative_prompt = '', aspect_ratio = '1:1' } = body;

  let params;
  try {
    const { paramsJson, signature } = await signTransloaditParams({
      steps: {
        generated_image: {
          robot: '/image/generate',
          result: true,
          aspect_ratio,
          model,
          prompt,
          ...(negative_prompt ? { negative_prompt } : {}),
        },
      },
    });
    params = { paramsJson, signature };
  } catch (err) {
    return json({ error: err.message }, 500);
  }

  const form = new URLSearchParams();
  form.set('params', params.paramsJson);
  form.set('signature', params.signature);

  const upstream = await fetch('https://api2.transloadit.com/assemblies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  });

  const raw = await upstream.json();
  if (!upstream.ok || raw.error) {
    return json({ error: raw.message || raw.error || 'Transloadit assembly creation failed', details: raw }, upstream.status);
  }

  const assemblyId = raw.assembly_id;
  if (!assemblyId) return json({ error: 'Transloadit returned no assembly_id', details: raw }, 502);

  // Poll until done (max ~2 min, 2s intervals)
  let result = null;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2000));

    const pollRes = await fetch(`https://api2.transloadit.com/assemblies/${assemblyId}`);
    const pollData = await pollRes.json();

    if (pollData.ok === 'ASSEMBLY_COMPLETED') {
      result = pollData;
      break;
    }
    if (pollData.error || pollData.ok === 'ASSEMBLY_CANCELED') {
      return json({ error: pollData.message || 'Transloadit assembly failed', details: pollData }, 502);
    }
    // ASSEMBLY_EXECUTING / ASSEMBLY_UPLOADING — keep polling
  }

  if (!result) {
    return json({
      status: 'pending',
      assembly_id: assemblyId,
      message: 'Poll GET /api/image?assembly_id=<assembly_id> for result',
      provider: 'transloadit',
      model,
    }, 202, resolvedThreadId ? { 'X-Thread-Id': resolvedThreadId } : {});
  }

  // Extract image URLs from the result
  const stepResults = result.results?.generated_image || [];
  const images = stepResults.map((r) => ({ url: r.ssl_url || r.url })).filter((r) => r.url);

  if (!images.length) return json({ error: 'Transloadit returned no images', details: result }, 502);

  if (sql && resolvedThreadId) {
    try {
      await saveMessage(sql, resolvedThreadId, 'assistant',
        JSON.stringify(images.map((img) => ({ type: 'image', url: img.url }))));
      await invalidateThreadCache(resolvedThreadId);
    } catch (err) {
      console.error('image.js: transloadit save failed:', err.message);
    }
  }

  return json({ images, model, provider: 'transloadit', assembly_id: assemblyId }, 200,
    resolvedThreadId ? { 'X-Thread-Id': resolvedThreadId } : {});
}

// ── Transloadit assembly poll (for client-side polling if 202 returned) ───────
async function pollTransloaditAssembly(assemblyId) {
  const res = await fetch(`https://api2.transloadit.com/assemblies/${assemblyId}`);
  const data = await res.json();
  if (!res.ok) return json({ error: 'Transloadit poll failed', details: data }, res.status);

  if (data.ok === 'ASSEMBLY_COMPLETED') {
    const stepResults = data.results?.generated_image || [];
    const images = stepResults.map((r) => ({ url: r.ssl_url || r.url })).filter((r) => r.url);
    return json({ status: 'done', images, provider: 'transloadit', assembly_id: assemblyId });
  }
  if (data.error || data.ok === 'ASSEMBLY_CANCELED') {
    return json({ status: 'failed', error: data.message || 'Assembly failed', provider: 'transloadit' }, 500);
  }
  return json({ status: 'pending', assembly_id: assemblyId, assembly_status: data.ok, provider: 'transloadit' }, 202);
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  const url = new URL(req.url);

  if (req.method === 'GET') {
    // GET ?list=models
    if (url.searchParams.get('list') === 'models') {
      const byProvider = {};
      for (const [id, def] of Object.entries(IMAGE_MODELS)) {
        if (!byProvider[def.provider]) byProvider[def.provider] = [];
        byProvider[def.provider].push(id);
      }
      return json({ models: Object.keys(IMAGE_MODELS), by_provider: byProvider });
    }
    // GET ?task_id=<id>  ->  poll DashScope wanx task
    const taskId = url.searchParams.get('task_id');
    if (taskId) {
      const apiKey = process.env.DASHSCOPE_API_KEY;
      if (!apiKey) return json({ error: 'DASHSCOPE_API_KEY is not set' }, 500);
      const res = await fetch(`https://dashscope-intl.aliyuncs.com/api/v1/tasks/${taskId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const data = await res.json();
      if (!res.ok) return json({ error: 'DashScope task poll failed', details: data }, res.status);
      const status = data.output?.task_status;
      if (status === 'SUCCEEDED') {
        const images = (data.output?.results || []).map((r) => ({ url: r.url }));
        return json({ status: 'done', images, provider: 'dashscope' });
      }
      if (status === 'FAILED') {
        return json({ status: 'failed', error: data.output?.message || 'Task failed', provider: 'dashscope' }, 500);
      }
      return json({ status: 'pending', task_status: status, task_id: taskId, provider: 'dashscope' }, 202);
    }
    // GET ?assembly_id=<id>  ->  poll Transloadit assembly
    const assemblyId = url.searchParams.get('assembly_id');
    if (assemblyId) return pollTransloaditAssembly(assemblyId);

    return json({ error: 'Use GET ?list=models, ?task_id=<id>, ?assembly_id=<id>, or POST to generate' }, 400);
  }

  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { model, prompt, threadId = null } = body || {};
  if (!model)  return json({ error: 'model is required' }, 400);
  if (!prompt) return json({ error: 'prompt is required' }, 400);

  const def = IMAGE_MODELS[model];
  if (!def) {
    return json({
      error: `Model "${model}" not supported`,
      available: Object.keys(IMAGE_MODELS),
    }, 403);
  }

  // Persistence (best-effort)
  let sql = null;
  let resolvedThreadId = null;
  try {
    sql = getSql();
    const userId = await getUserId(req);
    await ensureUser(sql, userId);
    resolvedThreadId = await getOrCreateThread(sql, userId, threadId, model);
    const existing = await sql`select 1 from messages where thread_id = ${resolvedThreadId} limit 1`;
    await saveMessage(sql, resolvedThreadId, 'user', prompt);
    if (existing.length === 0) await maybeAutoTitle(sql, resolvedThreadId, prompt);
    await invalidateThreadCache(resolvedThreadId);
  } catch (err) {
    console.error('image.js: persistence setup failed:', err.message);
    sql = null;
  }

  // Route to provider
  if (def.provider === 'dashscope')   return handleDashscope(body, resolvedThreadId, sql);
  if (def.provider === 'cloudflare')  return handleCloudflare(body, resolvedThreadId, sql);
  if (def.provider === 'transloadit') return handleTransloadit(body, resolvedThreadId, sql);

  return json({ error: `Provider "${def.provider}" not implemented` }, 501);
}
