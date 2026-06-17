// pages/api/jobs/[id].js
//
// GET /api/jobs/:id -> { status, output, error }
//
// Checks Redis cache first (cheap, avoids hammering Neon every 2s
// during a poll loop), and if the job isn't finished yet, calls
// advanceJob() to push it forward — meaning polling itself drives
// progress in v1, no separate cron required. Once you have real
// traffic, swap this for a Vercel Cron hitting a /api/jobs/sweep
// route every 10-15s so progress doesn't depend on the client
// staying connected.

import { getSql } from '../../../lib/db';
import { getUserId } from '../../../lib/auth';
import { getCachedJobStatus } from '../../../lib/cache';
import { advanceJob } from '../../../lib/jobRunner';

export const config = { runtime: 'edge' };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default async function handler(req) {
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  const sql = getSql();
  const userId = await getUserId(req);
  const url = new URL(req.url);
  const id = url.pathname.split('/').pop();

  const cached = await getCachedJobStatus(id);
  if (cached && cached.user_id === userId && (cached.status === 'done' || cached.status === 'failed')) {
    return json({ job: cached, cached: true });
  }

  const [job] = await sql`select * from jobs where id = ${id}`;
  if (!job || job.user_id !== userId) return json({ error: 'Job not found' }, 404);

  if (job.status === 'queued' || job.status === 'running') {
    try {
      const advanced = await advanceJob(sql, id);
      return json({ job: advanced, cached: false });
    } catch (err) {
      return json({ error: 'Failed to advance job', details: err.message }, 502);
    }
  }

  return json({ job, cached: false });
}
