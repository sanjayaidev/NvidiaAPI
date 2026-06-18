// lib/auth.js
//
// STUB AUTH. This is the ONLY file that should need to change when
// you wire up real auth (Clerk, Auth.js, etc). Every API route calls
// getUserId(req) instead of touching cookies/headers/JWTs directly.
//
// Right now it always returns a fixed demo user id so the rest of
// the system (threads, jobs, usage) can be built and tested against
// a real foreign key. Swap the body of getUserId() later; nothing
// else changes.

const DEMO_USER_ID = 'sanjay';

/**
 * @param {Request} req
 * @returns {Promise<string>} userId
 */
export async function getUserId(req) {
  // ---- FUTURE: real auth goes here ----
  // Example with Clerk (Node runtime only, not Edge):
  //   const { userId } = getAuth(req);
  //   if (!userId) throw new AuthError('unauthenticated');
  //   return userId;
  //
  // Example with a simple signed cookie / JWT (Edge-compatible):
  //   const token = req.headers.get('cookie')?.match(/session=([^;]+)/)?.[1];
  //   const payload = await verifyJwt(token);
  //   return payload.sub;

  return DEMO_USER_ID;
}

export class AuthError extends Error {}

/**
 * Ensures a user row exists (idempotent). Call this once per request
 * for now since we don't have a signup flow yet. Cheap upsert.
 */
export async function ensureUser(sql, userId) {
  await sql`
    insert into users (id, plan)
    values (${userId}, 'free')
    on conflict (id) do nothing
  `;
}
