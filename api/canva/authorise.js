// api/canva/authorize.js
//
// Node.js serverless function (Vercel's default runtime — do NOT set
// `runtime: 'edge'` here). Visit this endpoint in a browser to start the
// Canva OAuth flow: it generates a PKCE pair, stashes the verifier in
// Redis under a one-time state token, and redirects to Canva's authorize
// screen. Canva redirects back to /api/canva/callback when the user
// approves.

import crypto from 'node:crypto';
import { createPkcePair, saveAuthState, DEMO_USER_ID } from '../../lib/canva-auth';

export default async function handler(req, res) {
  const clientId = process.env.CANVA_CLIENT_ID;
  const redirectUri = process.env.CANVA_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('CANVA_CLIENT_ID / CANVA_REDIRECT_URI env vars are not set');
    return;
  }

  const { verifier, challenge } = createPkcePair();
  const state = crypto.randomUUID();

  await saveAuthState(state, verifier, DEMO_USER_ID);

  const authorizeUrl = new URL('https://mcp.canva.com/authorize');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('code_challenge', challenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');

  res.writeHead(302, { Location: authorizeUrl.toString() });
  res.end();
}
