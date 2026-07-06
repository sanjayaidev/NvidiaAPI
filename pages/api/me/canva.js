// pages/api/me/canva.js
//
// Session-authenticated endpoint for Canva MCP tool execution.
// Uses the Client ID + Client Secret auth flow (lib/canva-auth.js)
// instead of the CIMD/client-metadata.json approach.
//
// Body: { tool: "create_design" | "export_design" | ..., arguments: {...}, threadId }
// The exact tool names/arguments are whatever Canva's MCP server
// exposes — call POST /api/me/canva with { tool: "list_tools" } style
// discovery first if you want to enumerate them at runtime instead of
// hardcoding a list here.
//
// RUNTIME NOTE: this must run on Vercel's Node.js runtime, NOT edge —
// lib/canva-mcp.js needs Node APIs the MCP SDK relies on (see the
// comment at the top of that file). Every other pages/api/* route in
// this project declares `export const config = { runtime: 'edge' }` and
// uses the Fetch-style Request/Response API; this file previously copied
// that style (req.json(), `new Response(...)`) without realizing it
// can't be edge here, which meant every call crashed with something like
// "req.json is not a function" since the default Node.js runtime hands
// you a classic (req, res) pair, not a Fetch Request. Fixed below to use
// the plain Node.js request/response API instead, matching how
// api/chat-canva.js (also Node-only, for the same reason) is written.

import { getValidCanvaAccessToken, DEMO_USER_ID } from '../../../lib/canva-auth';
import { listCanvaTools, callCanvaTool } from '../../../lib/canva-mcp';

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { error: 'Invalid JSON body' });
  }

  const { tool, arguments: toolArgs = {}, threadId = null } = body || {};
  if (!tool) {
    return sendJson(res, 400, { error: '"tool" is required' });
  }

  // Single-identity personal-use setup, same as lib/canva-auth.js and
  // api/chat-canva.js. Swap DEMO_USER_ID for a real per-user id here
  // (from your session/auth layer) if you add multi-user support later —
  // note lib/session.js is currently Edge-only (Web Crypto based), so a
  // Node-compatible session lookup would need to be added alongside it.
  const accessToken = await getValidCanvaAccessToken(DEMO_USER_ID);
  if (!accessToken) {
    return sendJson(res, 403, {
      error: 'Canva not connected',
      action: 'reconnect',
      connect_url: '/api/canva/authorize',
    });
  }

  // Special handling for list_tools discovery
  if (tool === 'list_tools') {
    try {
      const tools = await listCanvaTools(accessToken);
      return sendJson(res, 200, { tools });
    } catch (err) {
      return sendJson(res, 500, { error: 'Failed to list Canva tools', details: err.message });
    }
  }

  // Execute a specific tool
  try {
    const result = await callCanvaTool(accessToken, tool, toolArgs);
    return sendJson(res, 200, { result, threadId });
  } catch (err) {
    return sendJson(res, err.status || 500, {
      error: err.message,
      details: err.details || {},
    });
  }
}
