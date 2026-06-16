// Test script to verify which NVIDIA models return valid responses
// Run with: node test-models.js
// Requires: NVIDIA_API_KEY environment variable

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';

// Exact list of allowed models - same as in chat.js
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

async function fetchModels() {
  // Return the curated list of allowed models
  return ALLOWED_MODELS;
}

async function testModel(modelId) {
  const testMessages = [
    { role: 'user', content: 'Say "OK" if you can respond.' }
  ];

  try {
    const response = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${NVIDIA_API_KEY}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages: testMessages,
        temperature: 0.3,
        max_tokens: 50,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    const data = await response.json();
    
    // Check if response has valid content
    const hasValidResponse = 
      data.choices && 
      Array.isArray(data.choices) && 
      data.choices.length > 0 &&
      data.choices[0].message &&
      data.choices[0].message.content;

    if (hasValidResponse) {
      return { 
        success: true, 
        content: data.choices[0].message.content.substring(0, 100) 
      };
    } else {
      return { success: false, error: 'Response missing content' };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function main() {
  if (!NVIDIA_API_KEY) {
    console.error('ERROR: NVIDIA_API_KEY environment variable is not set');
    console.log('Please set it: export NVIDIA_API_KEY="your-api-key-here"');
    process.exit(1);
  }

  console.log('Fetching available models from NVIDIA...\n');
  const models = await fetchModels();

  if (models.length === 0) {
    console.log('No models found matching the allowed families.');
    process.exit(0);
  }

  console.log(`Found ${models.length} models to test:\n`);
  models.forEach(m => console.log(`  - ${m}`));
  console.log('\n--- Testing each model ---\n');

  const workingModels = [];
  const failedModels = [];

  for (const model of models) {
    process.stdout.write(`Testing ${model}... `);
    const result = await testModel(model);
    
    if (result.success) {
      console.log('✓ WORKING');
      console.log(`  Response: "${result.content}"\n`);
      workingModels.push(model);
    } else {
      console.log('✗ FAILED');
      console.log(`  Error: ${result.error}\n`);
      failedModels.push({ model, error: result.error });
    }
  }

  console.log('\n========== SUMMARY ==========');
  console.log(`\n✓ WORKING MODELS (${workingModels.length}):`);
  workingModels.forEach(m => console.log(`  - ${m}`));

  if (failedModels.length > 0) {
    console.log(`\n✗ FAILED MODELS (${failedModels.length}):`);
    failedModels.forEach(({ model, error }) => {
      console.log(`  - ${model}`);
      console.log(`    Error: ${error.substring(0, 150)}${error.length > 150 ? '...' : ''}`);
    });
  }

  console.log('\n==============================');
  console.log('\nTo update chat.js with only working models, replace FALLBACK_MODELS with the working list above.');
}

main();
