// lib/providers/r2.js
//
// R2 is S3-compatible, so we use the standard AWS S3 client rather
// than a Cloudflare-specific SDK. Used to store binary outputs that
// come back as base64 (e.g. from NIM's /v1/infer) before saving a
// permanent URL into jobs.output.result_url / messages.attachments.
//
// Providers like Replicate already host their own output URLs —
// for those, you can either link directly to Replicate's URL
// (simplest, but it may expire) or re-upload to R2 for permanence.
// Recommended for a paid product: always re-upload to R2 so you're
// not dependent on a third party's URL lifetime.
//
// npm install @aws-sdk/client-s3

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

let client = null;

function getClient() {
  if (client) return client;
  const accountId = process.env.CF_R2_ACCOUNT_ID;
  const accessKeyId = process.env.CF_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.CF_R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('R2 credentials (CF_R2_ACCOUNT_ID / ACCESS_KEY_ID / SECRET_ACCESS_KEY) not set');
  }
  client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return client;
}

/**
 * @param {Buffer|Uint8Array} bytes
 * @param {string} key - path within the bucket, e.g. "jobs/<jobId>/output.png"
 * @param {string} contentType
 * @returns {Promise<string>} public URL (assumes bucket has a public dev URL or custom domain configured)
 */
export async function uploadToR2(bytes, key, contentType) {
  const bucket = process.env.CF_R2_BUCKET;
  const publicBaseUrl = process.env.CF_R2_PUBLIC_BASE_URL; // e.g. https://assets.yourapp.com
  if (!bucket) throw new Error('CF_R2_BUCKET environment variable is not set');
  if (!publicBaseUrl) throw new Error('CF_R2_PUBLIC_BASE_URL environment variable is not set');

  const s3 = getClient();
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: bytes,
      ContentType: contentType,
    })
  );

  return `${publicBaseUrl}/${key}`;
}

/**
 * Convenience for NIM's base64 responses.
 */
export async function uploadBase64ToR2(base64Data, key, contentType) {
  const bytes = Uint8Array.from(Buffer.from(base64Data, 'base64'));
  return uploadToR2(bytes, key, contentType);
}
