// pages/api/blog/[id].js
//
// GET /api/blog/:id -> Poll for blog generation progress and completion
//
// Returns the current job status with incremental progress updates.
// Client polls this endpoint every 2-3 seconds until status is 'done' or 'failed'.

import { getSql } from '../../../lib/db';
import { getUserId } from '../../../lib/auth';
import { advanceBlogJob } from '../../../lib/blogRunner';

export const config = { runtime: 'edge' };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default async function handler(req) {
  if (req.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const sql = getSql();
  const userId = await getUserId(req);

  const url = new URL(req.url);
  const id = url.pathname.split('/').pop();

  // Get job and verify ownership
  let [job] = await sql`
    select id, user_id, tool, provider, status, input, output, error, created_at
    from jobs where id = ${id}
  `;

  if (!job || job.user_id !== userId) {
    return json({ error: 'Blog job not found' }, 404);
  }

  if (job.tool !== 'blog') {
    return json({ error: 'Not a blog generation job' }, 400);
  }

  // Opportunistically drive the job forward by one step (one section,
  // or the title-generation step) on every poll. This is what actually
  // makes generation progress — see lib/blogRunner.js for why this
  // can't safely be a background/fire-and-forget loop.
  if (job.status !== 'done' && job.status !== 'failed') {
    try {
      job = await advanceBlogJob(sql, job);
    } catch (err) {
      console.error(`advanceBlogJob failed for ${job.id}:`, err.message);
    }
  }

  // Parse output JSON
  let output = {};
  try {
    output = typeof job.output === 'string' ? JSON.parse(job.output) : job.output || {};
  } catch {}

  // Parse input JSON
  let input = {};
  try {
    input = typeof job.input === 'string' ? JSON.parse(job.input) : job.input || {};
  } catch {}

  return json({
    jobId: job.id,
    status: job.status,
    provider: job.provider,
    progress: {
      totalSections: output.totalSections || 0,
      completedSections: output.completedSections || 0,
      currentSection: output.currentSection || null,
      percentage: output.totalSections > 0 
        ? Math.round((output.completedSections / output.totalSections) * 100) 
        : 0
    },
    content: output.content || '',
    titles: output.titles || [],
    format: output.format || input.format || 'plain',
    wordCount: output.wordCount || 0,
    error: job.error || output.error || null,
    createdAt: job.created_at,
  });
}
