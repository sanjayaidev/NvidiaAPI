// api/canva/tools.js
//
// Debug/discovery endpoint. Canva doesn't publish a fixed, versioned list
// of its MCP tool names anywhere I can point you to with certainty — the
// server exposes them dynamically via the MCP `tools/list` method. Hit
// this endpoint once you're connected to see the actual tool names,
// descriptions, and input schemas your connected account currently gets,
// so you know exactly what to reference in prompts (or in the frontend
// if you want a dedicated "list my designs" button instead of routing
// everything through chat).

import { getValidCanvaAccessToken, DEMO_USER_ID } from '../../lib/canva-auth';
import { listCanvaTools } from '../../lib/canva-mcp';

export default async function handler(req, res) {
  const token = await getValidCanvaAccessToken(DEMO_USER_ID);
  if (!token) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Canva not connected — visit /api/canva/authorize first' }));
    return;
  }

  try {
    const tools = await listCanvaTools(token);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ tools }, null, 2));
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}
