// api/canva/tools.js
//
// Debug/discovery endpoint. Canva doesn't publish a fixed, versioned list
// of its MCP tool names anywhere I can point you to with certainty — the
// server exposes them dynamically via the MCP `tools/list` method. Hit
// this endpoint once you're connected to see the actual tool names,
// descriptions, and input schemas your connected account currently gets.

import { getValidCanvaAccessToken, DEMO_USER_ID } from '../../lib/canva-auth';
import { listCanvaTools } from '../../lib/canva-mcp';

export default async function handler(req, res) {
  try {
    const token = await getValidCanvaAccessToken(DEMO_USER_ID);
    if (!token) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Canva not connected — visit /api/canva/authorize first' }));
      return;
    }

    const tools = await listCanvaTools(token);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ tools }, null, 2));
  } catch (err) {
    console.error('canva/tools.js failed:', err);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}