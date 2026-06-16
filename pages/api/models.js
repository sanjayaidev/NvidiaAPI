import OpenAI from 'openai';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const apiKey = process.env.NVIDIA_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'NVIDIA_API_KEY environment variable is not set' });
    }

    const client = new OpenAI({
      baseURL: 'https://integrate.api.nvidia.com/v1',
      apiKey: apiKey,
    });

    const modelsResponse = await client.models.list();
    
    const models = modelsResponse.data.map(model => ({
      id: model.id,
      name: model.id,
    }));

    res.status(200).json({ models });
  } catch (error) {
    console.error('Models API Error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch models',
      details: error.message 
    });
  }
}
