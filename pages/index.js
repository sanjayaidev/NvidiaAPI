import { useState, useRef, useEffect } from 'react';
import Head from 'next/head';

const AVAILABLE_MODELS = [
  { id: 'deepseek-ai/deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
  { id: 'meta/llama-3.1-70b-instruct', name: 'Llama 3.1 70B Instruct' },
  { id: 'meta/llama-3.1-8b-instruct', name: 'Llama 3.1 8B Instruct' },
  { id: 'google/gemma-2-27b-it', name: 'Gemma 2 27B IT' },
  { id: 'google/gemma-2-9b-it', name: 'Gemma 2 9B IT' },
  { id: 'mistralai/mistral-large-2-instruct', name: 'Mistral Large 2' },
  { id: 'mistralai/mixtral-8x22b-instruct-v0.1', name: 'Mixtral 8x22B' },
  { id: 'microsoft/phi-3-medium-128k-instruct', name: 'Phi-3 Medium' },
  { id: 'microsoft/phi-3-mini-128k-instruct', name: 'Phi-3 Mini' },
  { id: 'nvidia/nemotron-4-340b-instruct', name: 'Nemotron 4 340B' },
];

export default function Home() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState('deepseek-ai/deepseek-v4-flash');
  const [showModelSelect, setShowModelSelect] = useState(false);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = { role: 'user', content: input.trim() };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...messages, userMessage],
          model: selectedModel,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.details || 'Failed to send message');
      }

      const data = await response.json();
      const assistantMessage = {
        role: 'assistant',
        content: data.choices[0]?.message?.content || 'No response received',
      };
      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Error:', error);
      setMessages(prev => [...prev, {
        role: 'system',
        content: `Error: ${error.message}`,
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearChat = () => {
    setMessages([]);
  };

  return (
    <>
      <Head>
        <title>NVIDIA Chat - DeepSeek V4 Flash</title>
        <meta name="description" content="Chat with AI using NVIDIA NVAI API" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main className="container">
        <header className="header">
          <h1>🤖 NVIDIA Chat System</h1>
          <div className="model-selector">
            <button 
              className="model-btn"
              onClick={() => setShowModelSelect(!showModelSelect)}
            >
              📦 {AVAILABLE_MODELS.find(m => m.id === selectedModel)?.name || selectedModel}
            </button>
            
            {showModelSelect && (
              <div className="model-dropdown">
                {AVAILABLE_MODELS.map(model => (
                  <button
                    key={model.id}
                    className={`model-option ${selectedModel === model.id ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedModel(model.id);
                      setShowModelSelect(false);
                    }}
                  >
                    {model.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </header>

        <div className="chat-container">
          <div className="messages">
            {messages.length === 0 ? (
              <div className="welcome-message">
                <p>👋 Welcome! Start a conversation with the AI.</p>
                <p>Currently using: <strong>{AVAILABLE_MODELS.find(m => m.id === selectedModel)?.name}</strong></p>
              </div>
            ) : (
              messages.map((msg, index) => (
                <div key={index} className={`message ${msg.role}`}>
                  <div className="message-content">
                    <strong>{msg.role === 'user' ? '👤 You' : msg.role === 'assistant' ? '🤖 AI' : '⚠️ System'}:</strong>
                    <p>{msg.content}</p>
                  </div>
                </div>
              ))
            )}
            {isLoading && (
              <div className="message assistant">
                <div className="message-content">
                  <p>Thinking...</p>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <form className="input-form" onSubmit={handleSubmit}>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type your message..."
              disabled={isLoading}
              className="text-input"
            />
            <button 
              type="submit" 
              disabled={isLoading || !input.trim()}
              className="send-btn"
            >
              Send
            </button>
            <button 
              type="button" 
              onClick={handleClearChat}
              className="clear-btn"
            >
              Clear
            </button>
          </form>
        </div>

        <footer className="footer">
          <p>Powered by NVIDIA NVAI API • DeepSeek V4 Flash & More</p>
        </footer>
      </main>

      <style jsx>{`
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
        }

        .container {
          max-width: 900px;
          margin: 0 auto;
          padding: 20px;
          min-height: 100vh;
          display: flex;
          flex-direction: column;
        }

        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
          padding: 20px;
          background: rgba(255, 255, 255, 0.95);
          border-radius: 12px;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }

        .header h1 {
          font-size: 1.5rem;
          color: #333;
        }

        .model-selector {
          position: relative;
        }

        .model-btn {
          padding: 10px 16px;
          background: #667eea;
          color: white;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-size: 0.9rem;
          transition: background 0.2s;
        }

        .model-btn:hover {
          background: #5568d3;
        }

        .model-dropdown {
          position: absolute;
          top: 100%;
          right: 0;
          margin-top: 8px;
          background: white;
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
          max-height: 300px;
          overflow-y: auto;
          z-index: 100;
          min-width: 250px;
        }

        .model-option {
          display: block;
          width: 100%;
          padding: 12px 16px;
          background: none;
          border: none;
          text-align: left;
          cursor: pointer;
          transition: background 0.2s;
          font-size: 0.9rem;
        }

        .model-option:hover {
          background: #f0f0f0;
        }

        .model-option.selected {
          background: #667eea;
          color: white;
        }

        .chat-container {
          flex: 1;
          display: flex;
          flex-direction: column;
          background: rgba(255, 255, 255, 0.95);
          border-radius: 12px;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
          overflow: hidden;
        }

        .messages {
          flex: 1;
          overflow-y: auto;
          padding: 20px;
          max-height: 60vh;
        }

        .welcome-message {
          text-align: center;
          color: #666;
          padding: 40px 20px;
        }

        .message {
          margin-bottom: 16px;
          display: flex;
        }

        .message.user {
          justify-content: flex-end;
        }

        .message.assistant {
          justify-content: flex-start;
        }

        .message.system {
          justify-content: center;
        }

        .message-content {
          max-width: 70%;
          padding: 12px 16px;
          border-radius: 12px;
          line-height: 1.5;
        }

        .user .message-content {
          background: #667eea;
          color: white;
          border-bottom-right-radius: 4px;
        }

        .assistant .message-content {
          background: #f0f0f0;
          color: #333;
          border-bottom-left-radius: 4px;
        }

        .system .message-content {
          background: #fff3cd;
          color: #856404;
          border: 1px solid #ffc107;
        }

        .message-content strong {
          display: block;
          margin-bottom: 8px;
          font-size: 0.85rem;
        }

        .message-content p {
          white-space: pre-wrap;
          word-break: break-word;
        }

        .input-form {
          display: flex;
          gap: 10px;
          padding: 20px;
          border-top: 1px solid #e0e0e0;
          background: #fafafa;
        }

        .text-input {
          flex: 1;
          padding: 12px 16px;
          border: 2px solid #e0e0e0;
          border-radius: 8px;
          font-size: 1rem;
          outline: none;
          transition: border-color 0.2s;
        }

        .text-input:focus {
          border-color: #667eea;
        }

        .text-input:disabled {
          background: #f0f0f0;
          cursor: not-allowed;
        }

        .send-btn, .clear-btn {
          padding: 12px 24px;
          border: none;
          border-radius: 8px;
          font-size: 1rem;
          cursor: pointer;
          transition: all 0.2s;
          font-weight: 600;
        }

        .send-btn {
          background: #667eea;
          color: white;
        }

        .send-btn:hover:not(:disabled) {
          background: #5568d3;
        }

        .send-btn:disabled {
          background: #ccc;
          cursor: not-allowed;
        }

        .clear-btn {
          background: #f0f0f0;
          color: #666;
        }

        .clear-btn:hover {
          background: #e0e0e0;
        }

        .footer {
          text-align: center;
          padding: 20px;
          color: rgba(255, 255, 255, 0.8);
          font-size: 0.9rem;
        }

        @media (max-width: 600px) {
          .header {
            flex-direction: column;
            gap: 16px;
          }

          .header h1 {
            font-size: 1.2rem;
          }

          .message-content {
            max-width: 85%;
          }

          .input-form {
            flex-wrap: wrap;
          }

          .text-input {
            width: 100%;
          }

          .send-btn, .clear-btn {
            flex: 1;
          }
        }
      `}</style>
    </>
  );
}
