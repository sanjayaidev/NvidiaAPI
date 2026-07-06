// api/canva/status.js
//
// Quick check the frontend can poll: is a Canva account currently connected?

import { getValidCanvaAccessToken, DEMO_USER_ID } from '../../lib/canva-auth';

export default async function handler(req, res) {
  try {
    const token = await getValidCanvaAccessToken(DEMO_USER_ID);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ connected: Boolean(token) }));
  } catch (err) {
    console.error('canva/status.js failed:', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}