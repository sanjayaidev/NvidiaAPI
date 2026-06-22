// pages/api/audio/asr.js
// ASR via Cloudflare Workers AI (@cf/openai/whisper) — free tier
// Accepts multipart/form-data with an 'audio' file field
export const config = { runtime: 'edge' };

const ASR_MODELS = {
  // Cloudflare Workers AI
  '@cf/openai/whisper': { provider: 'cloudflare' },
};

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

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  const url = new URL(req.url);

  if (req.method === 'GET') {
    if (url.searchParams.get('list') === 'models') {
      const byProvider = {};
      for (const [id, def] of Object.entries(ASR_MODELS)) {
        if (!byProvider[def.provider]) byProvider[def.provider] = [];
        byProvider[def.provider].push(id);
      }
      return json({ models: Object.keys(ASR_MODELS), by_provider: byProvider });
    }
    return json({ error: 'Use GET ?list=models or POST to transcribe audio' }, 400);
  }

  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const accountId = process.env.CF_ACCOUNT_ID;
  const apiToken  = process.env.CF_WORKERS_AI_TOKEN;
  if (!accountId || !apiToken) {
    return new Response(JSON.stringify({ error: 'CF_ACCOUNT_ID / CF_WORKERS_AI_TOKEN not set' }), { status: 500 });
  }

  let formData;
  try { formData = await req.formData(); }
  catch { return new Response(JSON.stringify({ error: 'Invalid form data' }), { status: 400 }); }

  const audioFile = formData.get('audio');
  if (!audioFile) return new Response(JSON.stringify({ error: 'audio field is required' }), { status: 400 });

  const audioBuffer = await audioFile.arrayBuffer();

  // CF Whisper accepts raw audio binary
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/openai/whisper`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/octet-stream' },
      body: audioBuffer,
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return new Response(JSON.stringify({ error: err?.errors?.[0]?.message || `CF error ${res.status}` }), { status: res.status });
  }

  const data = await res.json();
  const transcript = data?.result?.text || '';
  return new Response(JSON.stringify({ transcript, model: '@cf/openai/whisper', provider: 'cloudflare' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
