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

import { getValidCanvaAccessToken, DEMO_USER_ID } from '../../../lib/canva-auth';
import { listCanvaTools, callCanvaTool } from '../../../lib/canva-mcp';

const DEFAULT_RPM = 20; // Canva calls are heavier than chat tokens — keep this tighter

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

export default async function handler(req) {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { tool, arguments: toolArgs = {}, threadId = null } = body || {};
  if (!tool) {
    return json({ error: '"tool" is required' }, 400);
  }

  // Special handling for list_tools discovery
  if (tool === 'list_tools') {
    const accessToken = await getValidCanvaAccessToken(DEMO_USER_ID);
    if (!accessToken) {
      return json({ 
        error: 'Canva not connected', 
        action: 'reconnect', 
        connect_url: '/api/canva/authorize' 
      }, 403);
    }
    
    try {
      const tools = await listCanvaTools(accessToken);
      return json({ tools });
    } catch (err) {
      return json({ error: 'Failed to list Canva tools', details: err.message }, 500);
    }
  }

  // Execute a specific tool
  const accessToken = await getValidCanvaAccessToken(DEMO_USER_ID);
  if (!accessToken) {
    return json({ 
      error: 'Canva not connected', 
      action: 'reconnect', 
      connect_url: '/api/canva/authorize' 
    }, 403);
  }

  try {
    const result = await callCanvaTool(accessToken, tool, toolArgs);
    return json({ result });
  } catch (err) {
    return json({ 
      error: err.message, 
      details: err.details || {} 
    }, err.status || 500);
  }
}
