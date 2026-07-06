// lib/canva-mcp.js
//
// Thin wrapper around Canva's remote MCP server (https://mcp.canva.com/mcp).
// This is a Node-only module — the MCP SDK uses Node APIs that don't exist
// in Vercel's Edge Runtime, which is why this whole Canva bridge runs as a
// Node.js serverless function instead of edge (see api/chat-canva.js).
//
// Canva's MCP server is stateless-friendly: each call below opens a fresh
// connection, does its job, and closes. That's deliberate — serverless
// functions don't have a good place to keep a long-lived MCP session alive
// between invocations, so we just pay the (small) reconnect cost per call.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const CANVA_MCP_URL = 'https://mcp.canva.com/mcp';

async function withCanvaClient(accessToken, fn) {
  const transport = new StreamableHTTPClientTransport(new URL(CANVA_MCP_URL), {
    requestInit: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  });

  const client = new Client(
    { name: 'nim-canva-bridge', version: '1.0.0' },
    { capabilities: {} }
  );

  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

// Returns the raw MCP tool list (name, description, inputSchema per tool).
export async function listCanvaTools(accessToken) {
  return withCanvaClient(accessToken, async (client) => {
    const { tools } = await client.listTools();
    return tools;
  });
}

// Invokes one Canva MCP tool by name with the given arguments object.
export async function callCanvaTool(accessToken, name, args) {
  return withCanvaClient(accessToken, async (client) => {
    return client.callTool({ name, arguments: args });
  });
}

// NVIDIA NIM's chat/completions endpoint speaks OpenAI's tool-calling
// format, so we translate Canva's MCP tool schemas into that shape:
//   { type: "function", function: { name, description, parameters } }
export function mcpToolsToOpenAIFormat(mcpTools) {
  return mcpTools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description || '',
      parameters: t.inputSchema || { type: 'object', properties: {} },
    },
  }));
}
