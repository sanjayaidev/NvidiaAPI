// pages/api/threads/index.js
//
// GET  /api/threads?tool=chat              -> list this user's threads for a tool
// GET  /api/threads?tool=chat&model=meta/... -> list filtered further by model
// POST /api/threads { tool, model, title? } -> create a new thread
//
// This is what gives you "separate conversation window per model
// with history" — a thread is always scoped to exactly one
// tool+model pair, like a browser tab pinned to one site.

import { getSql } from '../../../lib/db';
import { getUserId, ensureUser } from '../../../lib/auth';
import { isAllowedModel } from '../../../lib/registry';

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
  await ensureUser(sql, userId);

  if (req.method === 'GET') {
    const url = new URL(req.url);
    const tool = url.searchParams.get('tool');
    const model = url.searchParams.get('model');

    if (!tool) return json({ error: 'tool query param is required' }, 400);

    const rows = model
      ? await sql`
          select id, tool, model, title, pinned, archived, created_at, updated_at
          from threads
          where user_id = ${userId} and tool = ${tool} and model = ${model} and archived = false
          order by pinned desc, updated_at desc
        `
      : await sql`
          select id, tool, model, title, pinned, archived, created_at, updated_at
          from threads
          where user_id = ${userId} and tool = ${tool} and archived = false
          order by pinned desc, updated_at desc
        `;

    return json({ threads: rows });
  }

  if (req.method === 'POST') {
    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }

    const { tool, model, title } = body || {};
    if (!tool || !model) return json({ error: 'tool and model are required' }, 400);
    if (!isAllowedModel(model)) return json({ error: `Model "${model}" is not allowed` }, 403);

    const rows = await sql`
      insert into threads (user_id, tool, model, title)
      values (${userId}, ${tool}, ${model}, ${title || 'New conversation'})
      returning id, tool, model, title, pinned, archived, created_at, updated_at
    `;

    return json({ thread: rows[0] }, 201);
  }

  return json({ error: 'Method not allowed' }, 405);
}
