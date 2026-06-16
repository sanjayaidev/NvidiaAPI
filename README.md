# NVIDIA NIM Chat (single Edge Function)

A Next.js app, deployable on Vercel as **one Edge Function**, that chats with
any free model in NVIDIA's NIM catalog (`integrate.api.nvidia.com`).

## What was wrong with the original repo

1. **OpenAI SDK on the Edge runtime.** `pages/api/chat.js` and `models.js`
   used the `openai` npm package, which pulls in Node-only modules
   (`agentkeepalive`, `https.Agent`, `node-fetch`'s polyfills). None of that
   runs in Vercel's Edge runtime, so "deploy as an edge function" was never
   actually possible with that code — it would only work as a Node
   serverless function, contradicting the "one edge func" requirement.
2. **Two functions instead of one.** `chat.js` and `models.js` were separate
   serverless functions. They're now merged: `GET /api/chat?list=models`
   and `POST /api/chat` are handled by the same edge function.
3. **Hardcoded, stale model list.** The README advertised models
   (`deepseek-v4-flash`, `llama-3.1-70b-instruct`, etc.) that may or may not
   still be free or even exist in NVIDIA's catalog by the time you deploy.
   The fix queries NVIDIA's live `/v1/models` endpoint at request time, so
   the dropdown always reflects whatever is actually free right now. A
   small hardcoded list is kept only as a fallback if that call fails.
4. **The UI wasn't wired to anything.** `nvidia.html` (renamed
   `public/app.html`) was a fully static mockup — the model list and the
   chat both faked their responses in client-side JS. It's now wired to
   real model loading and a real streaming chat call.
5. **Dead config.** `next.config.js` had `output: 'standalone'`, which is
   for self-hosted Node servers, not Vercel — removed.

## Project structure

```
pages/
  api/
    chat.js       # single Edge Function: GET ?list=models, POST = chat (streaming or not)
  index.js        # redirects "/" to the static UI
public/
  app.html        # your original UI, wired to /api/chat
next.config.js
package.json
.env.example
```

## Setup

```bash
npm install
cp .env.example .env.local
# put your real key in .env.local:
# NVIDIA_API_KEY=nvapi-...
npm run dev
```

Open http://localhost:3000 — it redirects to the chat UI. The model
dropdown populates from NVIDIA's live catalog; pick one and chat.

## Deploying on Vercel

1. Push to GitHub, import the repo in Vercel.
2. Add the environment variable `NVIDIA_API_KEY` (get one free at
   https://build.nvidia.com/ → API Keys).
3. Deploy. `pages/api/chat.js` ships as a single Edge Function
   (`export const config = { runtime: 'edge' }`).

## API

### `GET /api/chat?list=models`
Returns the live, current free model catalog from NVIDIA:
```json
{ "models": ["nvidia/nemotron-3-ultra-550b-a55b", "z-ai/glm-5.1", "..."] }
```

### `POST /api/chat`
```json
{
  "messages": [{ "role": "user", "content": "Hello!" }],
  "model": "nvidia/nemotron-3-ultra-550b-a55b",
  "stream": true
}
```
With `stream: true`, the response is a passthrough SSE stream in the
standard OpenAI `delta.content` chunk format. With `stream: false`, it
returns a single OpenAI-shaped JSON completion.

## Notes

- NVIDIA's free catalog changes over time — that's why this app reads it
  live instead of hardcoding model names that will eventually 404 or stop
  being free.
- Free-tier rate limits and credits are governed by NVIDIA, not this app;
  check https://build.nvidia.com/ for current limits.
