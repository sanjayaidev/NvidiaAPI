// api/canva/authorize.js
//
// Node.js serverless function (Vercel's default runtime — do NOT set
// `runtime: 'edge'` here). Visit this endpoint in a browser to start the
// Canva OAuth flow: it generates a PKCE pair, stashes the verifier in
// Redis under a one-time state token, and redirects to Canva's authorize
// screen. Canva redirects back to /api/canva/callback when the user
// approves.
//
// NOTE: this file used to be named authorise.js (British spelling), which
// silently 404'd every "Connect Canva" click since the UI and README both
// link to /api/canva/authorize (American spelling) — Vercel routes purely
// off the filename. Keep this filename matching the links below.

import crypto from 'node:crypto';
import { createPkcePair, saveAuthState, DEMO_USER_ID } from '../../lib/canva-auth';

function missingEnvVars() {
  const required = [
    'CANVA_CLIENT_ID',
    'CANVA_REDIRECT_URI',
    'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN',
  ];
  return required.filter((key) => !process.env[key]);
}

export default async function handler(req, res) {
  try {
    const missing = missingEnvVars();
    if (missing.length) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(
        `Missing required environment variable(s): ${missing.join(', ')}\n` +
          `Set these in Vercel → Project Settings → Environment Variables, ` +
          `for the environment you're actually hitting (Production for a ` +
          `*.vercel.app deploy — Preview vars don't apply there).`
      );
      return;
    }

    const { verifier, challenge } = createPkcePair();
    const state = crypto.randomUUID();

    await saveAuthState(state, verifier, DEMO_USER_ID);

    const authorizeUrl = new URL('https://mcp.canva.com/authorize');
    authorizeUrl.searchParams.set('client_id', process.env.CANVA_CLIENT_ID);
    authorizeUrl.searchParams.set('redirect_uri', process.env.CANVA_REDIRECT_URI);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('code_challenge', challenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');

    res.writeHead(302, { Location: authorizeUrl.toString() });
    res.end();
  } catch (err) {
    console.error('canva/authorize.js failed:', err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(`authorize failed: ${err.message}`);
  }
}