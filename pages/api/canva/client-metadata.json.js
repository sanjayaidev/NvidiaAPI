// pages/api/canva/client-metadata.json.js
//
// This IS the OAuth client_id — as a fetchable URL. Canva's MCP auth
// server GETs this document at /authorize time instead of looking up
// a pre-registered Developer Portal app. Must be publicly reachable
// (no auth in front of it) and must report client_id as its own URL,
// byte for byte.

import { CANVA_SCOPES } from '../../../lib/canva';

export const config = { runtime: 'edge' };

export default function handler(req) {
  const url = new URL(req.url);
  const selfUrl = `${url.origin}/api/canva/client-metadata.json`;
  const redirectUri = `${url.origin}/api/canva/callback`;

  const doc = {
    client_id: selfUrl,
    client_name: 'SM Agents',
    redirect_uris: [redirectUri],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none', // public client — PKCE only
    scope: CANVA_SCOPES,
  };

  return new Response(JSON.stringify(doc, null, 2), {
    headers: { 'content-type': 'application/json' },
  });
}
