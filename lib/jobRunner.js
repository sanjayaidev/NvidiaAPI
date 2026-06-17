// lib/jobRunner.js
//
// One function, `advanceJob`, that knows how to move a job forward
// regardless of which provider it belongs to. Called from two
// places:
//   1. jobs/create.js — right after creating the row, best-effort
//   2. jobs/[id].js (status poll) — opportunistically, so polling
//      itself drives progress without needing a separate cron in v1
//
// This keeps provider-specific branching in exactly one place
// instead of duplicated across routes.

import * as replicate from './providers/replicate';
import * as nim from './providers/nim';
import * as transloadit from './providers/transloadit';
import * as cloudflare from './providers/cloudflare';
import { uploadBase64ToR2 } from './providers/r2';
import { cacheJobStatus, invalidateThreadCache } from './cache';

/**
 * @param {ReturnType<typeof import('./db').getSql>} sql
 * @param {string} jobId
 */
export async function advanceJob(sql, jobId) {
  const [job] = await sql`select * from jobs where id = ${jobId}`;
  if (!job) throw new Error(`Job ${jobId} not found`);
  if (job.status === 'done' || job.status === 'failed') return job; // nothing to do

  let updated;
  switch (job.provider) {
    case 'replicate':
      updated = await advanceReplicate(job);
      break;
    case 'nim':
      updated = await advanceNim(job);
      break;
    case 'transloadit':
      updated = await advanceTransloadit(job);
      break;
    case 'cf-worker-exec':
      updated = await advanceCfWorkerExec(job);
      break;
    case 'cf-browser-rendering':
      updated = await advanceCfBrowser(job);
      break;
    default:
      updated = { status: 'failed', error: `Unknown provider "${job.provider}"` };
  }

  const [saved] = await sql`
    update jobs set
      status = ${updated.status},
      output = ${JSON.stringify(updated.output || {})},
      error = ${updated.error || null},
      external_ref = coalesce(${updated.externalRef || null}, external_ref)
    where id = ${jobId}
    returning *
  `;

  await cacheJobStatus(jobId, saved);
  if (job.thread_id && (saved.status === 'done' || saved.status === 'failed')) {
    await recordAssistantMessage(sql, job.thread_id, saved);
    await invalidateThreadCache(job.thread_id);
  }

  return saved;
}

// ---------------- per-provider step logic ----------------

async function advanceReplicate(job) {
  if (!job.external_ref) {
    // First call: kick off the prediction.
    const { externalRef } = await replicate.startJob({
      modelId: job.input.model,
      input: job.input,
    });
    return { status: 'running', externalRef, output: {} };
  }
  const result = await replicate.checkStatus(job.external_ref);
  if (result.status === 'done') {
    return { status: 'done', output: { result_url: result.outputUrl, raw: result.raw } };
  }
  if (result.status === 'failed') {
    return { status: 'failed', error: result.error || 'Replicate job failed' };
  }
  return { status: result.status, output: job.output };
}

async function advanceNim(job) {
  // NIM's /v1/infer is a single blocking call (see lib/providers/nim.js)
  // so this finishes in one step rather than needing a poll loop.
  const result = await nim.runInferJob({ modelId: job.input.model, input: job.input });
  if (result.status === 'failed') {
    return { status: 'failed', error: result.error };
  }

  // Most NIM media responses carry base64 payload under a model-
  // specific key — adjust this per model family as you wire up
  // real responses; this is a reasonable default guess to start from.
  const base64 = result.raw?.video || result.raw?.audio || result.raw?.image;
  if (!base64) {
    return { status: 'done', output: { raw: result.raw } }; // no binary payload, just return raw
  }

  const ext = job.tool === 'video' ? 'mp4' : job.tool === 'audio' ? 'wav' : 'png';
  const contentType = job.tool === 'video' ? 'video/mp4' : job.tool === 'audio' ? 'audio/wav' : 'image/png';
  const url = await uploadBase64ToR2(base64, `jobs/${job.id}/output.${ext}`, contentType);

  return { status: 'done', output: { result_url: url } };
}

async function advanceTransloadit(job) {
  if (!job.external_ref) {
    const { externalRef } = await transloadit.startJob({
      templateId: job.input.templateId,
      fileUrl: job.input.fileUrl,
      extra: job.input.extra,
    });
    return { status: 'running', externalRef, output: {} };
  }
  const result = await transloadit.checkStatus(job.external_ref);
  if (result.status === 'done') {
    return { status: 'done', output: { result_url: result.outputUrl, raw: result.raw } };
  }
  if (result.status === 'failed') {
    return { status: 'failed', error: result.error || 'Transloadit assembly failed' };
  }
  return { status: result.status, output: job.output };
}

async function advanceCfWorkerExec(job) {
  const result = await cloudflare.runCodeExec({ code: job.input.code, args: job.input.args });
  if (result.status === 'failed') return { status: 'failed', error: result.error };
  return { status: 'done', output: { result: result.output } };
}

async function advanceCfBrowser(job) {
  const result = await cloudflare.runBrowserAutomation(job.input);
  if (result.status === 'failed') return { status: 'failed', error: result.error };
  return { status: 'done', output: { result: result.output } };
}

// Once a job finishes (success or fail), drop an assistant-role
// message into the thread carrying the result, so the thread's
// history reads naturally even though generation happened async.
async function recordAssistantMessage(sql, threadId, job) {
  const attachment = job.output?.result_url
    ? [{ type: job.tool, url: job.output.result_url }]
    : [];
  const content =
    job.status === 'done'
      ? attachment.length
        ? null
        : 'Done.'
      : `Generation failed: ${job.error || 'unknown error'}`;

  await sql`
    insert into messages (thread_id, role, content, attachments, job_id)
    values (${threadId}, 'assistant', ${content}, ${JSON.stringify(attachment)}, ${job.id})
  `;
  await sql`update threads set updated_at = now() where id = ${threadId}`;
}
