// scripts/create-api-key.js
//
// Manual CLI for minting a new client key. Run with:
//   node scripts/create-api-key.js --tier managed --label "alice" --cap 200
//   node scripts/create-api-key.js --tier byok --label "bob" --nvidia-key nvapi-...
//
// Prints the RAW key ONCE — copy it now, it is not recoverable after this.
// Requires DATABASE_URL and BYOK_ENCRYPTION_SECRET in the environment.
//
// This intentionally does NOT use lib/db.js's Neon driver (that's for the
// edge functions) — plain `pg` keeps this script runnable in any Node
// environment without edge-runtime constraints. npm install pg first.

const { Client } = require('pg');
const crypto = require('crypto');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i += 2) {
    out[args[i].replace(/^--/, '')] = args[i + 1];
  }
  return out;
}

function generateApiKey() {
  return 'sma_' + crypto.randomBytes(24).toString('hex');
}

function hashApiKey(rawKey) {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

// Mirrors lib/apiKeyAuth.js's AES-GCM scheme so keys created here can be
// decrypted by the edge function. Node's crypto module, not Web Crypto,
// since this script runs in plain Node — but same algorithm/params.
function deriveAesKey(secret) {
  return crypto.pbkdf2Sync(secret, 'smagents-byok-v1', 100_000, 32, 'sha256');
}

function encryptByokKey(rawNvidiaKey, secret) {
  const key = deriveAesKey(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(rawNvidiaKey, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Web Crypto's AES-GCM appends the auth tag to the ciphertext automatically;
  // Node's does not, so we append it manually to match what lib/apiKeyAuth.js
  // expects when it calls crypto.subtle.decrypt.
  const combined = Buffer.concat([encrypted, authTag]);
  return { enc: combined.toString('base64'), iv: iv.toString('base64') };
}

async function main() {
  const args = parseArgs();
  const tier = args.tier;
  if (tier !== 'managed' && tier !== 'byok') {
    console.error('Usage: --tier managed|byok --label <name> [--cap N] [--nvidia-key nvapi-...] [--models "model1,model2"]');
    process.exit(1);
  }
  if (tier === 'byok' && !args['nvidia-key']) {
    console.error('--nvidia-key is required for tier byok');
    process.exit(1);
  }

  const secret = process.env.BYOK_ENCRYPTION_SECRET;
  if (tier === 'byok' && !secret) {
    console.error('BYOK_ENCRYPTION_SECRET environment variable is not set');
    process.exit(1);
  }

  const rawKey = generateApiKey();
  const keyHash = hashApiKey(rawKey);
  const keyPrefix = rawKey.slice(0, 8);
  const allowedModels = args.models ? args.models.split(',').map((m) => m.trim()) : [];
  const dailyCap = args.cap ? parseInt(args.cap, 10) : 200;

  let encFields = { enc: null, iv: null };
  if (tier === 'byok') {
    encFields = encryptByokKey(args['nvidia-key'], secret);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `insert into api_keys
        (owner_label, key_hash, key_prefix, tier, allowed_models, byok_nvidia_key_enc, byok_nvidia_key_iv, daily_request_cap)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [args.label || 'unlabeled', keyHash, keyPrefix, tier, JSON.stringify(allowedModels), encFields.enc, encFields.iv, dailyCap]
    );
  } finally {
    await client.end();
  }

  console.log('\nKey created. Copy this now — it will not be shown again:\n');
  console.log(`  ${rawKey}\n`);
  console.log(`Tier: ${tier}`);
  console.log(`Daily cap: ${tier === 'managed' ? dailyCap : 'n/a (byok)'}`);
  console.log(`Allowed models: ${allowedModels.length ? allowedModels.join(', ') : 'all'}`);
}

main().catch((err) => {
  console.error('Failed to create key:', err.message);
  process.exit(1);
});
