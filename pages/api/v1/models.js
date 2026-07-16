export const config = { runtime: 'edge' };

// All available AI models - comprehensive list
const ALLOWED_MODELS = [
  'abacusai/dracarys-llama-3.1-70b-instruct',
  'deepseek-ai/deepseek-v4-flash',
  'deepseek-ai/deepseek-v4-pro',
  'google/gemma-2-2b-it',
  'google/gemma-3n-e2b-it',
  'google/gemma-3n-e4b-it',
  'meta/llama-3.1-70b-instruct',
  'meta/llama-3.1-8b-instruct',
  'meta/llama-3.2-11b-vision-instruct',
  'meta/llama-3.2-1b-instruct',
  'meta/llama-3.2-3b-instruct',
  'meta/llama-3.2-90b-vision-instruct',
  'meta/llama-3.3-70b-instruct',
  'meta/llama-4-maverick-17b-128e-instruct',
  'meta/llama-guard-4-12b',
  'mistralai/ministral-14b-instruct-2512',
  'mistralai/mistral-large-3-675b-instruct-2512',
  'mistralai/mistral-medium-3.5-128b',
  'mistralai/mistral-small-4-119b-2603',
  'mistralai/mixtral-8x7b-instruct-v0.1',
  'moonshotai/kimi-k2.6',
  'nvidia/ising-calibration-1-35b-a3b',
  'nvidia/llama-3.1-nemoguard-8b-content-safety',
  'nvidia/llama-3.1-nemoguard-8b-topic-control',
  'nvidia/llama-3.1-nemotron-nano-8b-v1',
  'nvidia/llama-3.1-nemotron-nano-vl-8b-v1',
  'nvidia/llama-3.3-nemotron-super-49b-v1',
  'nvidia/nemotron-3-nano-30b-a3b',
  'nvidia/nemotron-3-super-120b-a12b',
  'nvidia/nemotron-3-ultra-550b-a55b',
  'nvidia/nemotron-3.5-content-safety',
  'nvidia/nemotron-nano-12b-v2-vl',
  'upstage/solar-10.7b-instruct',
];

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  const data = {
    object: 'list',
    data: ALLOWED_MODELS.map((id) => ({
      id,
      object: 'model',
      created: 1720000000,
      owned_by: id.split('/')[0],
    })),
  };

  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}
