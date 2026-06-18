// lib/password.js
//
// Edge-compatible password hashing via Web Crypto's PBKDF2. Not using
// bcryptjs here (lib/session.js's existing comment flags bcryptjs as
// Node-only) because we want signup/login to run on the Edge runtime
// alongside everything else in this app.
//
// Format stored in users.password_hash: "<saltB64>:<hashB64>"
// — a random salt per user, so two identical passwords never produce
// the same stored hash.

const ITERATIONS = 100_000;

function toBase64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function fromBase64(str) {
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}

async function deriveBits(password, saltBytes) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return bits;
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hashBits = await deriveBits(password, salt);
  return `${toBase64(salt)}:${toBase64(hashBits)}`;
}

export async function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [saltB64, hashB64] = stored.split(':');
  const salt = fromBase64(saltB64);
  const expected = fromBase64(hashB64);
  const actualBits = await deriveBits(password, salt);
  const actual = new Uint8Array(actualBits);
  if (actual.length !== expected.length) return false;
  // Constant-time-ish comparison — avoids short-circuiting on first
  // mismatched byte, which matters for password hash comparisons.
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}
