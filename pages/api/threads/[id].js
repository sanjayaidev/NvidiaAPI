// pages/api/threads/[id].js
//
// GET    /api/threads/:id -> full message history for this thread
// PATCH  /api/threads/:id { title?, pinned?, archived? } -> update metadata
// DELETE /api/threads/:id -> hard delete (cascades to messages via FK)
//
// GET checks the Redis cache first (cache.js) before hitting Neon —
// this is the "instant reopen" behavior you get from a browser's
// history, without making every thread-open round-trip to Postgres.

import { getSql } from '../../../lib/db';
import { getUserId } from '../../../lib/auth';
import { getCachedThreadMessages, cacheThreadMessages, invalidateThreadCache } from '../../../lib/cache';

export const config = { runtime: 'edge' };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default async function handler(req) {
  const sql = getSql();
  const userId = await getUserId(req);

  const url = new URL(req.url);
  const id = url.pathname.split('/').pop();

  // Ownership check happens on every method — never trust the id alone.
  const [thread] = await sql`
    select id, user_id, tool, model, title, pinned, archived, created_at, updated_at
    from threads where id = ${id}
  `;
  if (!thread || thread.user_id !== userId) {
    return json({ error: 'Thread not found' }, 404);
  }

  if (req.method === 'GET') {
    const cached = await getCachedThreadMessages(id);
    if (cached) return json({ thread, messages: cached, cached: true });

    const messages = await sql`
      select id, role, content, attachments, job_id, created_at
      from messages where thread_id = ${id}
      order by created_at asc
    `;
    await cacheThreadMessages(id, messages);
    return json({ thread, messages, cached: false });
  }

  if (req.method === 'PATCH') {
    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }
    const { title, pinned, archived } = body || {};

    const rows = await sql`
      update threads set
        title = coalesce(${title}, title),
        pinned = coalesce(${pinned}, pinned),
        archived = coalesce(${archived}, archived)
      where id = ${id}
      returning id, tool, model, title, pinned, archived, created_at, updated_at
    `;
    return json({ thread: rows[0] });
  }

  if (req.method === 'DELETE') {
    await sql`delete from threads where id = ${id}`;
    await invalidateThreadCache(id);
    return json({ ok: true });
  }

  return json({ error: 'Method not allowed' }, 405);
}
