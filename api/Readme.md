# Canva MCP + NIM integration — setup

## 1. Register a Canva OAuth client (one-time, no waitlist needed)

```bash
curl --location 'https://mcp.canva.com/register' \
  --header 'Content-Type: application/json' \
  --data '{
      "client_name": "nim-canva-bridge",
      "redirect_uris": ["https://YOUR-VERCEL-DOMAIN/api/canva/callback"],
      "grant_types": ["authorization_code", "refresh_token"]
  }'
```

Save the `client_id` and `client_secret` from the response — you can't retrieve the secret again later.

## 2. Environment variables (Vercel project settings)

```
NVIDIA_API_KEY=...
CANVA_CLIENT_ID=...
CANVA_CLIENT_SECRET=...
CANVA_REDIRECT_URI=https://YOUR-VERCEL-DOMAIN/api/canva/callback
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

(`NVIDIA_API_KEY` and the Upstash vars you already have from chat.js.)

## 3. Install dependencies

```bash
npm install @modelcontextprotocol/sdk @upstash/redis @upstash/ratelimit
```

## 4. Connect your Canva account

After deploying, visit:

```
https://YOUR-VERCEL-DOMAIN/api/canva/authorize
```

in a browser. Approve access on Canva's screen — you'll land back on `/api/canva/callback`,
which stores your access + refresh token in Redis. Tokens auto-refresh on expiry, so you
only need to do this once (until you revoke access on Canva's side).

## 5. Use it

Call `/api/chat-canva` exactly like your existing `/api/chat`, just non-streaming:

```bash
curl -X POST https://YOUR-VERCEL-DOMAIN/api/chat-canva \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "meta/llama-3.3-70b-instruct",
    "messages": [
      { "role": "user", "content": "Create a 1080x1080 Instagram post design titled Summer Sale" }
    ]
  }'
```

If your Canva connection is active, the model gets Canva's full tool list (designs, assets,
folders, comments, brand kits) as callable functions and will invoke them automatically when
relevant. If nothing's connected yet, this endpoint behaves like a normal chat call.

## Notes / things to know

- **This is per-user auth.** Canva has no service-account mode — whoever authorizes at
  step 4 is whose Canva account gets used for every design/tool call. Fine for personal
  use; for multi-user you'd swap `DEMO_USER_ID` in `lib/canva-auth.js` for a real user id
  everywhere it's referenced.
- **Brand kits / brand templates / autofill** require a Canva Enterprise plan on the
  connected account; core design/export/comments work on any plan.
- **Tool-calling support depends on the model.** Not every NIM-hosted model handles the
  OpenAI-style `tools` / `tool_calls` format well — Llama 3.1/3.3 instruct and Mistral models
  are generally reliable choices; smaller/older models may ignore tools or hallucinate calls.
- **`/api/chat.js` is untouched.** This is a separate, opt-in endpoint so your existing
  fast/streaming chat path keeps working exactly as before.
