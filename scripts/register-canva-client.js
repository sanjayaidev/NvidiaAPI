// scripts/register-canva-client.js
//
// Run locally with: node scripts/register-canva-client.js
// (Node 18+ has fetch built in — no dependencies needed.)
//
// Registers an OAuth client with Canva's MCP server and prints the
// client_id / client_secret you'll put in your Vercel env vars
// (CANVA_CLIENT_ID / CANVA_CLIENT_SECRET — see .env.example).
// Save the output somewhere safe — the client_secret is not retrievable
// again after this call.
//
// The redirect URI below MUST exactly match (byte-for-byte — same
// scheme, host, path, trailing slash) the CANVA_REDIRECT_URI you set in
// Vercel and the redirect_uri your /api/canva/authorize and
// /api/canva/callback code sends. A mismatch here is the #1 cause of
// Canva's "mismatch callback url" / invalid redirect_uri error.

const REDIRECT_URI = 'https://smagents.vercel.app/api/canva/callback'; // <-- edit if your domain changes
const CLIENT_NAME = 'nim-canva-bridge';

async function registerClient() {
  const resp = await fetch('https://mcp.canva.com/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: CLIENT_NAME,
      redirect_uris: [REDIRECT_URI],
      grant_types: ['authorization_code', 'refresh_token'],
    }),
  });

  const text = await resp.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (_) {
    console.error('Non-JSON response from Canva:', text);
    process.exit(1);
  }

  if (!resp.ok) {
    console.error(`Registration failed (${resp.status}):`, data);
    process.exit(1);
  }

  console.log('Registered successfully. Save these now:\n');
  console.log('CANVA_CLIENT_ID=', data.client_id);
  console.log('CANVA_CLIENT_SECRET=', data.client_secret);
  console.log('CANVA_REDIRECT_URI=', REDIRECT_URI);
  console.log('\nFull response:', JSON.stringify(data, null, 2));
}

registerClient().catch((err) => {
  console.error('Request failed:', err.message);
  process.exit(1);
});
