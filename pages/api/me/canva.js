// pages/api/me/canva.js
//
// Session-authenticated counterpart for Canva, same shape as
// pages/api/me/chat.js: check session -> check the user actually has
// a Canva connection -> rate-limit -> do the work -> log a jobs row.
//
// Body: { tool: "create_design" | "export_design" | ..., arguments: {...}, threadId }
// The exact tool names/arguments are whatever Canva's MCP server
// exposes — call POST /api/me/canva with { tool: "list_tools" } style
// discovery first if you want to enumerate them at runtime instead of
// hardcoding a list here.

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { getSql } from '../../../lib/db';
import { readSessionCookie, getSessionUser } from '../../../lib/session';
import { getValidAccessToken, callCanvaMcpTool } from '../../../lib/canva';

export const config = { runtime: 'edge' };

const DEFAULT_RPM = 20; // Canva calls are heavier than chat tokens — keep this tighter

let redis = null;
let limiter = null;

function getLimiter() {
  if (limiter) return limiter;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  redis = redis || new Redis({ url, token });
  limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(DEFAULT_RPM, '60 s'),
    prefix: 'smagents-canva-ratelimit',
  });
  return limiter;
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const sql = getSql();
  const sessionToken = readSessionCookie(req);
  const session = await getSessionUser(sql, sessionToken);
  if (!session) {
    return json({ error: 'Not signed in' }, 401);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { tool, arguments: toolArgs = {}, threadId = null } = body || {};
  if (!tool) {
    return json({ error: '"tool" is required' }, 400);
  }

  const rl = getLimiter();
  if (rl) {
    const { success, limit, reset } = await rl.limit(session.userId);
    if (!success) {
      const retryAfterSec = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
      return json(
        { error: `Rate limit reached (${limit}/min). Try again shortly.`, retry_after_seconds: retryAfterSec },
        429,
        { 'Retry-After': String(retryAfterSec) }
      );
    }
  }

  let accessToken;
  try {
    accessToken = await getValidAccessToken(sql, session.userId);
  } catch (err) {
    if (err.code === 'NOT_CONNECTED' || err.code === 'NEEDS_RECONNECT') {
      return json({ error: err.message, action: 'reconnect', connect_url: '/api/canva/authorize' }, 403);
    }
    return json({ error: 'Failed to resolve Canva token', details: err.message }, 500);
  }

  const [jobRow] = await sql`
    insert into jobs (user_id, thread_id, tool, provider, status, input)
    values (${session.userId}, ${threadId}, 'canva', 'canva-mcp', 'running', ${JSON.stringify({ tool, arguments: toolArgs })})
    returning id
  `;

  try {
    const result = await callCanvaMcpTool(accessToken, tool, toolArgs);
    await sql`
      update jobs set status = 'done', output = ${JSON.stringify(result)} where id = ${jobRow.id}
    `;
    return json({ job_id: jobRow.id, result });
  } catch (err) {
    await sql`
      update jobs set status = 'failed', error = ${err.message} where id = ${jobRow.id}
    `;
    return json({ job_id: jobRow.id, error: err.message, details: err.details }, err.status || 500);
  }
}
