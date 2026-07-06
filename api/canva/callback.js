// api/canva/callback.js
//
// Canva redirects here after the user approves access. Exchanges the
// authorization code (+ PKCE verifier) for an access/refresh token pair
// and stores them in Redis, keyed by the userId that started the flow.

import { consumeAuthState, saveCanvaTokens } from '../../lib/canva-auth';

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const oauthError = url.searchParams.get('error');

    if (oauthError) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end(`Canva authorization error: ${oauthError}`);
      return;
    }

    if (!code || !state) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing code or state parameter');
      return;
    }

    const saved = await consumeAuthState(state);
    if (!saved) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid or expired state — start the flow again at /api/canva/authorize');
      return;
    }

    const tokenResp = await fetch('https://mcp.canva.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.CANVA_REDIRECT_URI,
        client_id: process.env.CANVA_CLIENT_ID,
        client_secret: process.env.CANVA_CLIENT_SECRET,
        code_verifier: saved.verifier,
      }),
    });

    if (!tokenResp.ok) {
      const text = await tokenResp.text();
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end(`Token exchange with Canva failed: ${text}`);
      return;
    }

    const tokens = await tokenResp.json();
    tokens.expires_at = Date.now() + (tokens.expires_in || 3600) * 1000;

    await saveCanvaTokens(saved.userId, tokens);

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><body>&#9989; Canva connected. You can close this tab.</body></html>');
  } catch (err) {
    console.error('canva/callback.js failed:', err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(`callback failed: ${err.message}`);
  }
}