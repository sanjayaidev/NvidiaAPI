# NVIDIA Chat System with Multimodal Selection

A modern chat application built with Next.js that connects to NVIDIA's NVAI API, featuring the DeepSeek V4 Flash model and multiple other AI models.

## 🚀 Live Demo

Deploy this application to Vercel for free:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/yourusername/nvidia-chat-system&env=NVIDIA_API_KEY)

## ✨ Features

- **🤖 Multiple AI Models**: Choose from various NVIDIA-hosted models including:
  - DeepSeek V4 Flash (default)
  - Llama 3.1 70B & 8B Instruct
  - Gemma 2 27B & 9B IT
  - Mistral Large 2
  - Mixtral 8x22B
  - Phi-3 Medium & Mini
  - Nemotron 4 340B

- **💬 Real-time Chat**: Smooth conversation interface with message history
- **🎨 Beautiful UI**: Modern, responsive design with gradient background
- **📱 Mobile Friendly**: Fully responsive for all device sizes
- **⚡ Fast Performance**: Optimized for quick responses
- **🔒 Secure**: API calls handled server-side

## 🛠️ Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn
- NVIDIA API Key (get it free from https://build.nvidia.com/)

### Installation

1. Clone the repository:
```bash
git clone <your-repo-url>
cd nvidia-chat-system
```

2. Install dependencies:
```bash
npm install
```

3. Create environment file:
```bash
cp .env.example .env.local
```

4. Add your NVIDIA API key to `.env.local`:
```
NVIDIA_API_KEY=your_actual_api_key_here
```

5. Run the development server:
```bash
npm run dev
```

6. Open [http://localhost:3000](http://localhost:3000) in your browser

## 📁 Project Structure

```
/workspace
├── pages/
│   ├── api/
│   │   ├── chat.js      # Chat endpoint (handles all AI requests)
│   │   └── models.js    # Models list endpoint
│   └── index.js         # Main chat UI
├── next.config.js       # Next.js configuration
├── package.json         # Dependencies
├── .env.example         # Environment variables template
└── README.md            # This file
```

## 🌐 Deployment on Vercel

1. Push your code to GitHub

2. Go to [Vercel](https://vercel.com) and import your repository

3. Add the environment variable:
   - Name: `NVIDIA_API_KEY`
   - Value: Your NVIDIA API key from https://build.nvidia.com/

4. Deploy!

### One-Click Deploy

Click the button above or use the Vercel CLI:

```bash
npm i -g vercel
vercel
```

## 🔑 Getting Your NVIDIA API Key

1. Visit [https://build.nvidia.com/](https://build.nvidia.com/)
2. Sign up or log in
3. Navigate to your API keys section
4. Create a new API key
5. Copy and save it securely

## 📝 API Endpoints

### POST /api/chat

Send a chat message and get AI response.

**Request Body:**
```json
{
  "messages": [
    { "role": "user", "content": "Hello!" }
  ],
  "model": "deepseek-ai/deepseek-v4-flash"
}
```

**Response:**
```json
{
  "id": "chatcmpl-xxx",
  "choices": [{
    "message": {
      "role": "assistant",
      "content": "Hello! How can I help you?"
    },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 20,
    "total_tokens": 30
  }
}
```

### GET /api/models

Fetch available AI models.

**Response:**
```json
{
  "models": [
    { "id": "deepseek-ai/deepseek-v4-flash", "name": "DeepSeek V4 Flash" }
  ]
}
```

## ⚙️ Configuration

All API logic is centralized in the `/pages/api` directory for easy deployment on Vercel as serverless functions.

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NVIDIA_API_KEY` | Yes | Your NVIDIA NVAI API key |

## 🆓 Free Tier Information

NVIDIA offers free API access with reasonable limits. Check [build.nvidia.com](https://build.nvidia.com/) for current pricing and limits.

## 📄 License

MIT License - feel free to use this project for personal or commercial purposes.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 🙏 Acknowledgments

- [NVIDIA](https://www.nvidia.com/) for providing the AI models
- [DeepSeek](https://www.deepseek.ai/) for the DeepSeek V4 Flash model
- [Next.js](https://nextjs.org/) for the amazing framework
- [Vercel](https://vercel.com/) for easy deployment
