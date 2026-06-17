// lib/registry.js
//
// Single source of truth for "what models exist, what tool do they
// belong to, which provider serves them, and how do we call them."
// Every route (chat.js, jobs/create.js, etc) reads from here instead
// of hardcoding provider logic per-route.
//
// mode: 'sync'  -> request/response, used by text chat (streams back immediately)
// mode: 'async' -> creates a job row, provider runs in background, client polls

export const TOOLS = {
  CHAT: 'chat',
  IMAGE: 'image',
  VIDEO: 'video',
  AUDIO: 'audio',
  AGENT: 'agent',
};

export const MODELS = [
  // ---------------- TEXT (NVIDIA NIM, sync, streaming) ----------------
  // Restored from the original ALLOWED_MODELS list in v2's chat.js —
  // all 20 are back, nothing dropped this time.
  { id: 'abacusai/dracarys-llama-3.1-70b-instruct', tool: TOOLS.CHAT, provider: 'nim', mode: 'sync' },
  { id: 'deepseek-ai/deepseek-v4-flash', tool: TOOLS.CHAT, provider: 'nim', mode: 'sync' },
  { id: 'deepseek-ai/deepseek-v4-pro', tool: TOOLS.CHAT, provider: 'nim', mode: 'sync' },
  { id: 'meta/llama-3.1-70b-instruct', tool: TOOLS.CHAT, provider: 'nim', mode: 'sync' },
  { id: 'meta/llama-3.1-8b-instruct', tool: TOOLS.CHAT, provider: 'nim', mode: 'sync' },
  { id: 'meta/llama-3.2-11b-vision-instruct', tool: TOOLS.CHAT, provider: 'nim', mode: 'sync' },
  { id: 'meta/llama-3.2-1b-instruct', tool: TOOLS.CHAT, provider: 'nim', mode: 'sync' },
  { id: 'meta/llama-3.2-3b-instruct', tool: TOOLS.CHAT, provider: 'nim', mode: 'sync' },
  { id: 'meta/llama-3.2-90b-vision-instruct', tool: TOOLS.CHAT, provider: 'nim', mode: 'sync' },
  { id: 'meta/llama-3.3-70b-instruct', tool: TOOLS.CHAT, provider: 'nim', mode: 'sync' },
  { id: 'meta/llama-4-maverick-17b-128e-instruct', tool: TOOLS.CHAT, provider: 'nim', mode: 'sync' },
  { id: 'meta/llama-guard-4-12b', tool: TOOLS.CHAT, provider: 'nim', mode: 'sync' },
  { id: 'mistralai/ministral-14b-instruct-2512', tool: TOOLS.CHAT, provider: 'nim', mode: 'sync' },
  { id: 'mistralai/mistral-large-3-675b-instruct-2512', tool: TOOLS.CHAT, provider: 'nim', mode: 'sync' },
  { id: 'mistralai/mistral-medium-3.5-128b', tool: TOOLS.CHAT, provider: 'nim', mode: 'sync' },
  { id: 'mistralai/mistral-small-4-119b-2603', tool: TOOLS.CHAT, provider: 'nim', mode: 'sync' },
  { id: 'mistralai/mixtral-8x7b-instruct-v0.1', tool: TOOLS.CHAT, provider: 'nim', mode: 'sync' },
  { id: 'moonshotai/kimi-k2.6', tool: TOOLS.CHAT, provider: 'nim', mode: 'sync' },
  { id: 'nvidia/llama-3.1-nemoguard-8b-content-safety', tool: TOOLS.CHAT, provider: 'nim', mode: 'sync' },
  { id: 'nvidia/llama-3.1-nemoguard-8b-topic-control', tool: TOOLS.CHAT, provider: 'nim', mode: 'sync' },

  // ---------------- IMAGE (no free NIM hosted endpoint — see prior research; use Replicate) ----------------
  { id: 'black-forest-labs/flux-1.1-pro', tool: TOOLS.IMAGE, provider: 'replicate', mode: 'async' },
  { id: 'black-forest-labs/flux-schnell', tool: TOOLS.IMAGE, provider: 'replicate', mode: 'async' },
  { id: 'stability-ai/stable-diffusion-3.5-large', tool: TOOLS.IMAGE, provider: 'replicate', mode: 'async' },

  // ---------------- VIDEO ----------------
  { id: 'nvidia/cosmos-transfer1-7b', tool: TOOLS.VIDEO, provider: 'nim', mode: 'async' }, // free, physics/world-sim style
  { id: 'nvidia/cosmos3-nano', tool: TOOLS.VIDEO, provider: 'nim', mode: 'async' },         // free, physics/world-sim style
  { id: 'wan-video/wan-2.1', tool: TOOLS.VIDEO, provider: 'replicate', mode: 'async' },     // creative text-to-video

  // ---------------- AUDIO ----------------
  { id: 'nvidia/magpie-tts-zeroshot', tool: TOOLS.AUDIO, provider: 'nim', mode: 'async' },   // free TTS
  { id: 'elevenlabs/tts-multilingual', tool: TOOLS.AUDIO, provider: 'elevenlabs', mode: 'async' },
  { id: 'openai/whisper-large-v3', tool: TOOLS.AUDIO, provider: 'cf-workers-ai', mode: 'async' }, // transcription via Cloudflare Workers AI

  // ---------------- AGENTS ----------------
  { id: 'agent/code-exec-js', tool: TOOLS.AGENT, provider: 'cf-worker-exec', mode: 'async' },
  { id: 'agent/browser-automation', tool: TOOLS.AGENT, provider: 'cf-browser-rendering', mode: 'async' },
];

export function findModel(id) {
  return MODELS.find((m) => m.id === id) || null;
}

export function modelsForTool(tool) {
  return MODELS.filter((m) => m.tool === tool);
}

export function isAllowedModel(id) {
  return Boolean(findModel(id));
}
