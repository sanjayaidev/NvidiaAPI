// pages/api/audio/tts.js
// TTS via Cloudflare Workers AI (@cf/myshell-ai/melo-tts) — free tier
export const config = { runtime: 'edge' };

const TTS_MODELS = {
  // Cloudflare Workers AI
  '@cf/myshell-ai/melo-tts': { provider: 'cloudflare', voices: ['male-1', 'female-1', 'male-2', 'female-2'] },
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
      for (const [id, def] of Object.entries(TTS_MODELS)) {
        if (!byProvider[def.provider]) byProvider[def.provider] = [];
        byProvider[def.provider].push({ id, voices: def.voices });
      }
      return json({ models: Object.keys(TTS_MODELS), by_provider: byProvider });
    }
    return json({ error: 'Use GET ?list=models or POST to generate speech' }, 400);
  }

  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const { text, voice = 'male-1' } = await req.json();
  if (!text) return new Response(JSON.stringify({ error: 'text is required' }), { status: 400 });

  const accountId = process.env.CF_ACCOUNT_ID;
  const apiToken  = process.env.CF_WORKERS_AI_TOKEN;
  if (!accountId || !apiToken) {
    return new Response(JSON.stringify({ error: 'CF_ACCOUNT_ID / CF_WORKERS_AI_TOKEN not set' }), { status: 500 });
  }

  // melo-tts voice IDs: EN-US, EN-BR, EN_INDIA, EN-AU, ES, FR, ZH, JP, KR
  const voiceMap = { 'male-1': 'EN-US', 'female-1': 'EN-BR', 'male-2': 'EN_INDIA', 'female-2': 'EN-AU' };
  const speakerId = voiceMap[voice] || 'EN-US';

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/myshell-ai/melo-tts`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken}` },
      body: JSON.stringify({ text, speed: 1.0, language: speakerId }),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return new Response(JSON.stringify({ error: err?.errors?.[0]?.message || `CF error ${res.status}` }), { status: res.status });
  }

  // CF returns audio binary directly
  const audio = await res.arrayBuffer();
  return new Response(audio, {
    status: 200,
    headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-cache' },
  });
}
