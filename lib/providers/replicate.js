// lib/providers/replicate.js
//
// Replicate's API is already async-by-design (create a "prediction",
// poll or get a webhook). That maps directly onto our jobs table —
// this adapter just translates between our generic job shape and
// Replicate's specific request/response shape.

const REPLICATE_API = 'https://api.replicate.com/v1';

function headers() {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error('REPLICATE_API_TOKEN environment variable is not set');
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Kicks off a prediction. `modelId` should be a Replicate model
 * version string or "owner/model" — caller (jobs/create route)
 * resolves this from the registry.
 *
 * @returns {Promise<{externalRef: string, raw: any}>}
 */
export async function startJob({ modelId, input }) {
  const res = await fetch(`${REPLICATE_API}/models/${modelId}/predictions`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ input }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Replicate startJob failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  return { externalRef: data.id, raw: data };
}

/**
 * @returns {Promise<{status: 'queued'|'running'|'done'|'failed', outputUrl?: string, error?: string, raw: any}>}
 */
export async function checkStatus(externalRef) {
  const res = await fetch(`${REPLICATE_API}/predictions/${externalRef}`, {
    headers: headers(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Replicate checkStatus failed (${res.status}): ${text}`);
  }
  const data = await res.json();

  const statusMap = {
    starting: 'queued',
    processing: 'running',
    succeeded: 'done',
    failed: 'failed',
    canceled: 'failed',
  };

  const status = statusMap[data.status] || 'running';
  // Replicate's `output` shape varies by model: sometimes a string
  // URL, sometimes an array of URLs. Normalize to the first URL.
  let outputUrl;
  if (Array.isArray(data.output)) outputUrl = data.output[0];
  else if (typeof data.output === 'string') outputUrl = data.output;

  return {
    status,
    outputUrl,
    error: data.error || undefined,
    raw: data,
  };
}
