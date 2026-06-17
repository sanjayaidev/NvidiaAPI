// lib/providers/transloadit.js
//
// Transloadit is async-by-design too: you create an "assembly" with
// a template (the processing steps), it processes, and either you
// poll the assembly status or it calls your webhook. We use the
// polling form here for consistency with every other provider in
// this file — see jobs/process.js for the shared polling loop.
//
// Typical use in this product: after an image/video job finishes
// from Replicate or NIM, optionally chain a Transloadit assembly to
// resize/watermark/transcode before the final R2 URL is shown to
// the user. The `templateId` is something you configure once in
// the Transloadit dashboard (e.g. "watermark-image-v1").

const TRANSLOADIT_API = 'https://api2.transloadit.com';

function authParams() {
  const key = process.env.TRANSLOADIT_AUTH_KEY;
  const secret = process.env.TRANSLOADIT_AUTH_SECRET;
  if (!key || !secret) {
    throw new Error('TRANSLOADIT_AUTH_KEY / TRANSLOADIT_AUTH_SECRET not set');
  }
  return { key, secret };
}

// Transloadit requires HMAC-signed params for server-to-server auth.
// This uses the Web Crypto API so it works in Edge Runtime too.
async function signParams(params) {
  const { key, secret } = authParams();
  const paramsJson = JSON.stringify({ auth: { key, expires: expiryString() }, ...params });

  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(paramsJson));
  const signature = Array.from(new Uint8Array(sigBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return { paramsJson, signature };
}

function expiryString() {
  const d = new Date(Date.now() + 1000 * 60 * 60); // 1hr from now
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '+00:00');
}

/**
 * @param {{templateId: string, fileUrl: string, extra?: object}} params
 * @returns {Promise<{externalRef: string, raw: any}>}
 */
export async function startJob({ templateId, fileUrl, extra = {} }) {
  const { paramsJson, signature } = await signParams({
    template_id: templateId,
    fields: { source_url: fileUrl, ...extra },
  });

  const form = new URLSearchParams();
  form.set('params', paramsJson);
  form.set('signature', signature);

  const res = await fetch(`${TRANSLOADIT_API}/assemblies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Transloadit startJob failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  return { externalRef: data.assembly_id, raw: data };
}

/**
 * @returns {Promise<{status:'queued'|'running'|'done'|'failed', outputUrl?:string, error?:string, raw:any}>}
 */
export async function checkStatus(externalRef) {
  const res = await fetch(`${TRANSLOADIT_API}/assemblies/${externalRef}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Transloadit checkStatus failed (${res.status}): ${text}`);
  }
  const data = await res.json();

  const statusMap = {
    ASSEMBLY_UPLOADING: 'queued',
    ASSEMBLY_EXECUTING: 'running',
    ASSEMBLY_COMPLETED: 'done',
    ASSEMBLY_CANCELED: 'failed',
  };
  const status = statusMap[data.ok] || (data.error ? 'failed' : 'running');

  // Result file URL location depends on your template's step name —
  // adjust `resized` / whatever step key you configured.
  const results = data.results || {};
  const firstStepResults = Object.values(results)[0];
  const outputUrl = Array.isArray(firstStepResults) ? firstStepResults[0]?.ssl_url : undefined;

  return { status, outputUrl, error: data.error, raw: data };
}
