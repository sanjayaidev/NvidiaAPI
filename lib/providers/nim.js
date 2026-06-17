// lib/providers/nim.js
//
// NIM's text chat endpoint (/v1/chat/completions) is synchronous and
// already handled directly in pages/api/chat.js — it streams, so it
// doesn't need the job model.
//
// NIM's /v1/infer endpoint (used by Cosmos video models and Magpie
// TTS) is a single blocking HTTP call that can take a while (video
// gen especially). Rather than holding a serverless function open
// for minutes, we fire it from a background invocation (see
// pages/api/jobs/process.js) and treat the whole call as one job
// step: it either finishes within that invocation and we mark the
// job 'done' immediately, or — for true long-running cases — you'd
// swap this to NIM's async submit+poll variant if/when the specific
// model exposes one. Check the model's own API reference page since
// this varies model-to-model.

const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';

function headers() {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) throw new Error('NVIDIA_API_KEY environment variable is not set');
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Runs synchronously but is called from the background job
 * processor (pages/api/jobs/process.js), not from the request that
 * created the job — so it's safe for this to take a while.
 *
 * @returns {Promise<{status:'done'|'failed', outputUrl?:string, error?:string, raw:any}>}
 */
export async function runInferJob({ modelId, input }) {
  const res = await fetch(`${NVIDIA_BASE_URL}/infer`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ model: modelId, ...input }),
  });

  if (!res.ok) {
    const text = await res.text();
    return { status: 'failed', error: `NIM infer failed (${res.status}): ${text}`, raw: null };
  }

  const data = await res.json();
  // NIM /v1/infer responses vary by model family; most return a
  // base64 payload (video/audio/image) under a model-specific key.
  // Caller (jobs/process.js) is responsible for uploading that
  // payload to R2 and passing back the resulting URL — this adapter
  // just returns the raw decoded response.
  return { status: 'done', raw: data };
}
