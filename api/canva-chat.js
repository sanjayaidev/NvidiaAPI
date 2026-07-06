// api/chat-canva.js
//
// Sibling to your existing api/chat.js, but this one runs on Vercel's
// Node.js runtime (not edge) because the MCP SDK needs Node APIs that
// don't exist at the edge. Keep chat.js as-is for plain fast chat; use
// this endpoint when you want the model to be able to call Canva.
//
// Flow: call NIM with `tools` built from the user's connected Canva MCP
// server -> if the model responds with tool_calls, execute them against
// Canva -> feed results back -> repeat until the model gives a final
// answer (or MAX_TOOL_ITERATIONS is hit).
//
// LIMITATION: non-streaming only for now. Streaming + a multi-turn tool
// loop don't mix cleanly (you'd need to buffer partial tool_calls across
// SSE chunks before you even know whether to call a tool), so this
// endpoint always returns one JSON blob once the whole loop finishes.

import { getValidCanvaAccessToken, DEMO_USER_ID } from '../lib/canva-auth';
import { listCanvaTools, callCanvaTool, mcpToolsToOpenAIFormat } from '../lib/canva-mcp';

const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';
const MAX_TOOL_ITERATIONS = 6;

// Keep this in sync with the ALLOWED_MODELS list in chat.js if you want
// to restrict which models can be used here too. Left open by default
// since this is a separate, opt-in endpoint.

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

async function callNim(apiKey, payload) {
  const resp = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`NVIDIA API error ${resp.status}: ${text}`);
  }

  return resp.json();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'NVIDIA_API_KEY environment variable is not set' }));
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (_) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON body' }));
    return;
  }

  const {
    messages,
    model = 'meta/llama-3.3-70b-instruct',
    temperature = 0.7,
    max_tokens = 2048,
  } = body || {};

  if (!messages || !Array.isArray(messages)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Messages array is required' }));
    return;
  }

  // Single-identity personal-use setup, same as chat.js. Swap in a real
  // per-user id here if you add multi-user auth later.
  const userId = DEMO_USER_ID;
  const canvaToken = await getValidCanvaAccessToken(userId);

  let tools;
  if (canvaToken) {
    try {
      const mcpTools = await listCanvaTools(canvaToken);
      tools = mcpToolsToOpenAIFormat(mcpTools);
    } catch (err) {
      console.error('chat-canva.js: failed to list Canva tools:', err.message);
    }
  }

  const conversation = messages.map((m) => ({ role: m.role, content: m.content }));
  const toolResults = []; // every tool call + its raw result, for the UI to inspect
  let finalData = null;

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const payload = {
      model,
      messages: conversation,
      temperature,
      max_tokens,
      top_p: 1,
      stream: false,
      ...(tools?.length ? { tools, tool_choice: 'auto' } : {}),
    };

    let data;
    try {
      data = await callNim(apiKey, payload);
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to reach NVIDIA API', details: err.message }));
      return;
    }

    const msg = data.choices?.[0]?.message;

    if (!msg?.tool_calls?.length) {
      finalData = data;
      break;
    }

    conversation.push(msg);

    for (const toolCall of msg.tool_calls) {
      const toolName = toolCall.function?.name;
      let args = {};
      try {
        args = JSON.parse(toolCall.function?.arguments || '{}');
      } catch (_) {
        // malformed args from the model -> call with empty args rather than crash
      }

      let result;
      let resultText;
      try {
        result = await callCanvaTool(canvaToken, toolName, args);
        resultText = JSON.stringify(result);
      } catch (err) {
        result = { error: err.message };
        resultText = JSON.stringify(result);
      }

      toolResults.push({ tool: toolName, args, result });

      conversation.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: resultText,
      });
    }

    if (i === MAX_TOOL_ITERATIONS - 1) {
      finalData = data; // hit the cap — return what we have rather than loop forever
    }
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      ...finalData,
      canva_connected: Boolean(canvaToken),
      tool_results: toolResults,
    })
  );
}
