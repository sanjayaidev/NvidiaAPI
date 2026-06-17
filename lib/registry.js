// Allowed models registry - shared across all API routes
// Exact list of allowed models - only these will appear in the dropdown
const ALLOWED_MODELS = [
  'abacusai/dracarys-llama-3.1-70b-instruct',
  'deepseek-ai/deepseek-v4-flash',
  'deepseek-ai/deepseek-v4-pro',
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
  'nvidia/llama-3.1-nemoguard-8b-content-safety',
  'nvidia/llama-3.1-nemoguard-8b-topic-control',
];

export function isAllowedModel(modelId) {
  return ALLOWED_MODELS.includes(modelId);
}

export { ALLOWED_MODELS };
