// lib/providers/cloudflare.js
//
// Two distinct Cloudflare capabilities, both called over plain HTTP
// from our Node/Edge functions — no Cloudflare SDK needed here,
// since we're calling INTO Cloudflare Workers we deploy separately,
// not running inside Cloudflare ourselves.
//
//   1. cf-worker-exec: a Worker you deploy yourself that runs
//      sandboxed JS for "code execution" agent requests. Vercel
//      Functions can't safely eval untrusted JS in-process; a
//      Worker with no filesystem/network access by default is a
//      reasonable sandbox boundary for JS specifically. For
//      Python/shell agents, don't use this — use a real container
//      sandbox (e.g. E2B) instead, Workers won't run those.
//
//   2. cf-browser-rendering: Cloudflare's hosted headless Chromium
//      (Playwright-compatible) — this is the actual "JS-based
//      browser automation" piece you asked for, and it's already a
//      product rather than something you self-host.
//      Docs: https://developers.cloudflare.com/browser-rendering/
//
// Both are request/response calls from our side, but we still run
// them through the job table because they can take several seconds
// and you'll likely want history/auditing of what an agent did.

function workerExecUrl() {
  const url = process.env.CF_WORKER_EXEC_URL;
  if (!url) throw new Error('CF_WORKER_EXEC_URL environment variable is not set');
  return url;
}

function browserRenderingUrl() {
  const url = process.env.CF_BROWSER_RENDERING_URL;
  if (!url) throw new Error('CF_BROWSER_RENDERING_URL environment variable is not set');
  return url;
}

/**
 * Runs a sandboxed JS snippet inside your deployed Worker.
 * Your Worker is responsible for the actual sandboxing (e.g. a
 * fresh isolate per request, no eval of secrets, timeouts).
 *
 * @returns {Promise<{status:'done'|'failed', output?:any, error?:string}>}
 */
export async function runCodeExec({ code, args }) {
  const res = await fetch(workerExecUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.CF_WORKER_SHARED_SECRET || ''}`,
    },
    body: JSON.stringify({ code, args }),
  });

  if (!res.ok) {
    const text = await res.text();
    return { status: 'failed', error: `Worker exec failed (${res.status}): ${text}` };
  }
  const data = await res.json();
  return { status: 'done', output: data };
}

/**
 * Runs a browser automation task (navigate, click, scrape, screenshot)
 * against Cloudflare Browser Rendering. `task` is whatever shape your
 * Worker expects — e.g. { url, actions: [...], screenshot: true }.
 *
 * @returns {Promise<{status:'done'|'failed', output?:any, error?:string}>}
 */
export async function runBrowserAutomation(task) {
  const res = await fetch(browserRenderingUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.CF_WORKER_SHARED_SECRET || ''}`,
    },
    body: JSON.stringify(task),
  });

  if (!res.ok) {
    const text = await res.text();
    return { status: 'failed', error: `Browser automation failed (${res.status}): ${text}` };
  }
  const data = await res.json();
  return { status: 'done', output: data };
}
