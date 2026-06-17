// lib/db.js
//
// Neon's serverless driver talks to Postgres over HTTP/fetch instead
// of a raw TCP connection — meaning it works inside Vercel's Edge
// Runtime, same as our chat.js. This is why we picked Neon over a
// plain pg/postgres.js setup: no connection pooling headaches, no
// "fetch only" runtime conflicts.
//
// npm install @neondatabase/serverless

import { neon } from '@neondatabase/serverless';

let sql = null;

export function getSql() {
  if (sql) return sql;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL environment variable is not set');
  }
  sql = neon(url);
  return sql;
}
