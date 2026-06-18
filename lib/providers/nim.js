// lib/providers/nim.js — diff reference only, not a full file.
//
// Change headers() to accept an optional override so BYOK requests use
// the client's decrypted key instead of process.env.NVIDIA_API_KEY.
// Everywhere else in this file that calls headers() with no args keeps
// using your personal key exactly as today — this is additive, not a
// breaking change to the existing personal chat.js flow.

function headers(overrideApiKey) {
  const apiKey = overrideApiKey || process.env.NVIDIA_API_KEY;
  if (!apiKey) throw new Error('No NVIDIA API key available (neither override nor NVIDIA_API_KEY env var)');
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

// runInferJob and any other exported function that calls headers()
// should accept and forward the same optional key, e.g.:
//
// export async function runInferJob({ modelId, input, apiKey }) {
//   const res = await fetch(`${NVIDIA_BASE_URL}/infer`, {
//     method: 'POST',
//     headers: headers(apiKey),
//     body: JSON.stringify({ model: modelId, ...input }),
//   });
//   ...
