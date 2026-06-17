// pages/api/jobs/create.js
//
// POST /api/jobs { tool, model, input, threadId? }
//
// Creates a job row, fires the provider call in the background
// (without awaiting full completion — see "fire and forget" note
// below), and returns the job id immediately so the client can
// start polling GET /api/jobs/:id. This is what makes image/video/
// audio/agent generation feel responsive instead of hanging the
// request for 30+ seconds.
//
// NOTE on the Edge Runtime "fire and forget" pattern: Vercel Edge
// functions don't have Node's `process` lifecycle, but they DO let
// you return a Response while a promise you didn't await keeps
// running, via `waitUntil` if using the Vercel-specific request
// context, OR by simply not awaiting and accepting the function may
// be torn down before it finishes (risky). The safe, portable
// approach used here: the job starts in 'queued' state, and a
// separate lightweight processor (pages/api/jobs/process.js) is
// what actually drives it forward — triggered either by a cron
// (Vercel Cron) hitting it every ~10s, or by the client's own poll
// hitting GET /api/jobs/:id, which opportunistically advances the
// job if it's still queued. This avoids relying on undocumented
// background-execution behavior.

import { getSql } from '../../../lib/db';
import { getUserId, ensureUser } from '../../../lib/auth';
import { checkRateLimit } from '../../../lib/ratelimit';
import { findModel } from '../../../lib/registry';
import { advanceJob } from '../../../lib/jobRunner';

export const config = { runtime: 'edge' };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const sql = getSql();
  const userId = await getUserId(req);
  await ensureUser(sql, userId);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { model, input, threadId } = body || {};
  const modelDef = findModel(model);
  if (!modelDef) return json({ error: `Model "${model}" is not allowed` }, 403);
  if (modelDef.mode !== 'async') {
    return json({ error: `Model "${model}" is sync — use /api/chat instead` }, 400);
  }

  // Optional thread ownership check (jobs can exist without a thread too)
  if (threadId) {
    const [thread] = await sql`select id, user_id from threads where id = ${threadId}`;
    if (!thread || thread.user_id !== userId) {
      return json({ error: 'Thread not found' }, 404);
    }
  }

  const rl = await checkRateLimit(`${modelDef.provider}:${model}`);
  if (!rl.ok) {
    return json(
      { error: `Rate limit reached for "${model}". Try again shortly.`, retry_after_seconds: rl.retryAfterSec },
      429
    );
  }

  const [job] = await sql`
    insert into jobs (user_id, thread_id, tool, provider, status, input)
    values (${userId}, ${threadId || null}, ${modelDef.tool}, ${modelDef.provider}, 'queued', ${JSON.stringify({ model, ...input })})
    returning id, tool, provider, status, input, output, created_at
  `;

  // Best-effort kick: try to advance the job once immediately so
  // simple/fast providers can finish within this same request and
  // the client's first poll already sees progress. If this throws
  // or the provider is slow, we swallow the error here — the cron
  // processor (or the client's next poll) will pick it up.
  try {
    await advanceJob(sql, job.id);
  } catch (err) {
    console.error(`advanceJob failed for ${job.id}:`, err.message);
  }

  return json({ jobId: job.id, status: job.status }, 201);
}
