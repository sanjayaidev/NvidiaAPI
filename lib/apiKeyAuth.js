// lib/apiKeyAuth.js
//
// Auth for the EXTERNAL/public-facing route (pages/api/v1/chat.js),
// separate from lib/auth.js which is your personal-use stub for the
// original pages/api/chat.js. Clients authenticate with a bearer key
// instead of a session/cookie.
//
// Key lifecycle:
//   1. You generate a raw key (generateApiKey) and hand it to a client
//      ONCE — it is never stored or shown again after that.
//   2. We store only sha256(rawKey) in api_keys.key_hash.
//   3. Every request, we hash the incoming bearer key and look up the
//      row by hash — never by comparing raw strings, never decrypting
//      anything to "check" the key itself.
//
// BYOK NVIDIA keys ARE stored (encrypted), because the client doesn't
// want to send it on every request. That's a deliberate, narrower
// exception — encrypted at rest with AES-GCM, decrypted only for the
// single outgoing NVIDIA call, never logged.

const ENC_ALGO = { name: 'AES-GCM', length: 256 };

function getMasterKeyMaterial() {
  const secret = process.env.BYOK_ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error('BYOK_ENCRYPTION_SECRET environment variable is not set');
  }
  return secret;
}

async function deriveAesKey() {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(getMasterKeyMaterial()),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  // Static salt is acceptable here: we're deriving ONE app-wide key from
  // a high-entropy secret, not hashing many low-entropy user passwords.
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('smagents-byok-v1'), iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    ENC_ALGO,
    false,
    ['encrypt', 'decrypt']
  );
}

function toBase64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function fromBase64(str) {
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}

function toHex(bytes) {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Generates a new raw API key. Show this to the client ONCE; only its hash is stored. */
export function generateApiKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const raw = 'sma_' + toHex(bytes); // 'sma_' prefix makes leaked-key scanning easier later
  return raw;
}

export async function hashApiKey(rawKey) {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(rawKey));
  return toHex(digest);
}

/**
 * Encrypts a client-supplied NVIDIA key for storage.
 * @returns {Promise<{enc: string, iv: string}>} both base64
 */
export async function encryptByokKey(rawNvidiaKey) {
  const key = await deriveAesKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(rawNvidiaKey));
  return { enc: toBase64(ciphertext), iv: toBase64(iv) };
}

export async function decryptByokKey(encB64, ivB64) {
  const key = await deriveAesKey();
  const iv = fromBase64(ivB64);
  const ciphertext = fromBase64(encB64);
  const plaintextBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plaintextBuf);
}

/**
 * Looks up an api_keys row from the raw bearer key in the request.
 * Updates last_used_at best-effort (failure to update doesn't block the request).
 *
 * @returns {Promise<{
 *   id: string, tier: 'managed'|'byok', allowedModels: string[],
 *   dailyRequestCap: number, rpmOverride: number|null,
 *   nvidiaKey: string|null  // decrypted, only present for byok tier
 * } | null>}
 */
export async function authenticateApiKey(sql, req) {
  const authHeader = req.headers.get('authorization') || '';
  const rawKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (!rawKey) return null;

  const keyHash = await hashApiKey(rawKey);
  const rows = await sql`
    select id, tier, allowed_models, byok_nvidia_key_enc, byok_nvidia_key_iv,
           daily_request_cap, rpm_override, active
    from api_keys where key_hash = ${keyHash}
  `;
  const row = rows[0];
  if (!row || !row.active) return null;

  let nvidiaKey = null;
  if (row.tier === 'byok') {
    if (!row.byok_nvidia_key_enc || !row.byok_nvidia_key_iv) return null; // misconfigured BYOK row
    try {
      nvidiaKey = await decryptByokKey(row.byok_nvidia_key_enc, row.byok_nvidia_key_iv);
    } catch (err) {
      console.error('apiKeyAuth: failed to decrypt BYOK key for', row.id, err.message);
      return null;
    }
  }

  // Best-effort, never blocks the request.
  sql`update api_keys set last_used_at = now() where id = ${row.id}`.catch(() => {});

  return {
    id: row.id,
    tier: row.tier,
    allowedModels: row.allowed_models || [],
    dailyRequestCap: row.daily_request_cap,
    rpmOverride: row.rpm_override,
    nvidiaKey,
  };
}

/**
 * Checks + increments today's request count for a managed-tier key in
 * one atomic upsert. Only call this for tier === 'managed' — BYOK keys
 * burn the client's own NVIDIA quota, not yours, so no daily cap applies.
 *
 * @returns {Promise<{ok: true, remaining: number} | {ok: false, used: number, cap: number}>}
 */
export async function checkAndIncrementDailyCap(sql, apiKeyId, cap) {
  const rows = await sql`
    insert into api_key_daily_usage (api_key_id, day, request_count)
    values (${apiKeyId}, current_date, 1)
    on conflict (api_key_id, day)
    do update set request_count = api_key_daily_usage.request_count + 1
    returning request_count
  `;
  const used = rows[0].request_count;
  if (used > cap) return { ok: false, used, cap };
  return { ok: true, remaining: cap - used };
}
