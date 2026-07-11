// pages/api/blog/generate.js
//
// POST /api/blog/generate { topic, keywords?, cta?, format: 'plain'|'html', model? }
//
// Creates a blog generation job for long-form content (>2000 words) that may take
// longer than Vercel's default 25s timeout. Returns a jobId immediately, client
// polls GET /api/blog/:id for progress and completion.
//
// This follows the same pattern as /api/jobs/create.js but is specialized for
// blog/article generation with chunked processing if needed.

import { getSql } from '../../../lib/db';
import { getUserId, ensureUser } from '../../../lib/auth';
import { checkRateLimit } from '../../../lib/ratelimit';
import { isAllowedModel } from '../../../lib/registry';
import { advanceBlogJob } from '../../../lib/blogRunner';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const config = {
  runtime: 'edge',
  maxDuration: 60, // Vercel Pro/Enterprise supports up to 60s
};

export default async function handler(req) {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  // Check Content-Type header
  const contentType = req.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    return json({
      error: 'Invalid Content-Type',
      message: 'Content-Type must be application/json'
    }, 400);
  }

  const sql = getSql();
  const userId = await getUserId(req);
  await ensureUser(sql, userId);

  let body;
  try {
    body = await req.json();
  } catch (err) {
    console.error('JSON parse error:', err.message);
    return json({
      error: 'Invalid JSON body',
      message: 'Request body must be valid JSON',
      details: err.message
    }, 400);
  }

  const { topic, keywords = '', cta = '', format = 'plain', model = 'mistralai/mistral-large-3-675b-instruct-2512' } = body || {};

  if (!topic || topic.trim().length === 0) {
    return json({ error: 'Blog topic is required' }, 400);
  }

  if (!isAllowedModel(model)) {
    return json({ error: `Model "${model}" is not allowed` }, 403);
  }

  // Rate limit check
  const rl = await checkRateLimit(`blog:${model}`);
  if (!rl.ok) {
    return json({
      error: `Rate limit reached. Try again shortly.`,
      retry_after_seconds: rl.retryAfterSec
    }, 429);
  }

  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    return json({ error: 'NVIDIA_API_KEY environment variable is not set' }, 500);
  }

  const primaryKeyword = keywords.split(',')[0]?.trim() || topic.split(' ')[0];
  
  // Create generic sections immediately (don't wait for AI outline)
  const sections = [
    { section: 'Introduction', prompt: `Write an engaging introduction about ${topic}`, wordCount: 300 },
    { section: 'Understanding the Basics', prompt: `Explain the fundamentals of ${topic}`, wordCount: 400 },
    { section: 'Key Benefits', prompt: `Discuss the main benefits and advantages`, wordCount: 400 },
    { section: 'Practical Tips', prompt: `Provide actionable tips and strategies`, wordCount: 500 },
    { section: 'Common Mistakes', prompt: `Highlight common pitfalls to avoid`, wordCount: 300 },
    { section: 'Advanced Techniques', prompt: `Share advanced insights for experienced readers`, wordCount: 400 },
    { section: 'Case Studies & Examples', prompt: `Provide real-world examples and case studies`, wordCount: 400 },
    { section: 'Tools & Resources', prompt: `Recommend useful tools and resources`, wordCount: 300 },
    { section: 'FAQ', prompt: `Answer frequently asked questions about ${topic}`, wordCount: 300 },
    { section: 'Conclusion', prompt: `Summarize key points and include CTA: ${cta}`, wordCount: 200 },
  ];

  try {
    // Create job record FIRST - return immediately
    const [job] = await sql`
      insert into jobs (user_id, tool, provider, status, input, output)
      values (${userId}, 'blog', 'nvidia-chat', 'running', ${JSON.stringify({
        topic,
        keywords,
        cta,
        format,
        model,
        sections,
        primaryKeyword
      })}, ${JSON.stringify({
        status: 'queued',
        totalSections: sections.length,
        completedSections: 0,
        content: '',
        titles: []
      })})
      returning id, status, input, output, created_at
    `;

    // Best-effort kick: advance the job by one step (one section)
    // synchronously so the client's very first poll already sees
    // progress. This mirrors pages/api/jobs/create.js. We deliberately
    // do NOT fire-and-forget the rest of the sections here — an
    // unawaited async call has no guarantee of continuing to run once
    // this response is sent (Edge/Node functions can be frozen right
    // after the response goes out). Instead, GET /api/blog/:id
    // advances the job by one more step on every poll, so progress is
    // driven forward by requests that are actually being awaited.
    try {
      await advanceBlogJob(sql, job);
    } catch (err) {
      console.error(`advanceBlogJob failed for ${job.id}:`, err.message);
    }

    return json({
      jobId: job.id,
      status: job.status,
      estimatedTime: Math.ceil(sections.length * 3) // ~3 seconds per section
    }, 201);

  } catch (err) {
    console.error('Blog generation setup failed:', err);
    return json({ error: 'Failed to start blog generation', details: err.message }, 500);
  }
}
