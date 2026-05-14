import React, { useState, useEffect, useRef } from 'react';
import { Send, Trash2, Plus, X, Sparkles, Terminal, Code2, ShieldAlert, Cpu } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  agentType?: string;
}

const vscode = (window as any).acquireVsCodeApi();

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentAgent, setCurrentAgent] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.addEventListener('message', event => {
      const message = event.data;
      switch (message.type) {
        case 'userMessage':
          setMessages(prev => [...prev, { role: 'user', content: message.content }]);
          break;
        case 'startStream':
          setIsStreaming(true);
          setCurrentAgent(message.agentType);
          setMessages(prev => [...prev, { role: 'assistant', content: '', agentType: message.agentType }]);
          break;
        case 'streamDelta':
          setMessages(prev => {
            const newMessages = [...prev];
            const lastMessage = newMessages[newMessages.length - 1];
            if (lastMessage && lastMessage.role === 'assistant') {
              lastMessage.content += message.delta;
            }
            return newMessages;
          });
          break;
        case 'streamEnd':
          setIsStreaming(false);
          setCurrentAgent(null);
          break;
        case 'conversationCleared':
          setMessages([]);
          break;
      }
    });
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    if (!input.trim() || isStreaming) return;
    
    let slashCommand = '';
    let content = input;
    if (input.startsWith('/')) {
      const parts = input.split(' ');
      slashCommand = parts[0];
      content = parts.slice(1).join(' ');
    }

    vscode.postMessage({ type: 'sendMessage', content, slashCommand });
    setInput('');
  };

  const clearChat = () => {
    vscode.postMessage({ type: 'clearConversation' });
  };

  const newChat = () => {
    vscode.postMessage({ type: 'newConversation' });
  };

  return (
    <div className="flex flex-col h-screen bg-vscode-bg text-vscode-fg font-sans selection:bg-fuelix-purple/30">
      {/* Header */}
      <header className="flex items-center justify-between p-3 border-b border-vscode-border bg-vscode-bg/80 backdrop-blur-md sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-gradient-to-br from-fuelix-purple to-fuelix-blue rounded-lg flex items-center justify-center shadow-lg shadow-fuelix-purple/20">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-sm tracking-tight">Fuelix AI</span>
        </div>
        <div className="flex gap-1">
          <button onClick={newChat} className="p-1.5 hover:bg-vscode-accent/20 rounded-md transition-colors" title="New Chat">
            <Plus className="w-4 h-4" />
          </button>
          <button onClick={clearChat} className="p-1.5 hover:bg-red-500/20 text-red-400 rounded-md transition-colors" title="Clear Chat">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-thin scrollbar-thumb-vscode-border">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full opacity-50 space-y-4 text-center">
            <Cpu className="w-12 h-12 text-fuelix-purple animate-pulse-slow" />
            <div className="max-w-xs space-y-2">
              <p className="text-sm font-medium">Fuelix AI is ready to build with you.</p>
              <p className="text-xs">Try <code className="bg-vscode-border px-1 rounded">/explain</code>, <code className="bg-vscode-border px-1 rounded">/debug</code>, or just ask a question.</p>
            </div>
          </div>
        )}
        
        <AnimatePresence initial={false}>
          {messages.map((m, i) => (
            <motion.div 
              key={i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}
            >
              {m.role === 'assistant' && m.agentType && (
                <div className="flex items-center gap-1.5 mb-1 text-[10px] uppercase tracking-widest font-bold text-fuelix-purple/80 px-1">
                  <span className="w-1 h-1 bg-fuelix-purple rounded-full animate-pulse" />
                  {m.agentType} agent
                </div>
              )}
              <div className={clsx(
                "max-w-[95%] p-3 rounded-2xl text-sm leading-relaxed",
                m.role === 'user' 
                  ? "bg-vscode-accent text-white rounded-tr-none shadow-lg shadow-vscode-accent/10" 
                  : "bg-vscode-border/30 backdrop-blur-sm border border-vscode-border/50 rounded-tl-none"
              )}>
                <ReactMarkdown
                  components={{
                    code({node, inline, className, children, ...props}: any) {
                      const match = /language-(\w+)/.exec(className || '');
                      return !inline && match ? (
                        <div className="my-2 rounded-lg overflow-hidden border border-vscode-border shadow-inner">
                          <div className="bg-vscode-border/50 px-3 py-1 text-[10px] font-mono flex justify-between items-center border-b border-vscode-border">
                            <span>{match[1]}</span>
                            <button className="hover:text-fuelix-purple transition-colors">Copy</button>
                          </div>
                          <SyntaxHighlighter
                            style={vscDarkPlus}
                            language={match[1]}
                            PreTag="div"
                            className="!m-0 !bg-black/20"
                            {...props}
                          >
                            {String(children).replace(/\n$/, '')}
                          </SyntaxHighlighter>
                        </div>
                      ) : (
                        <code className="bg-vscode-border/80 px-1.5 py-0.5 rounded font-mono text-[0.9em]" {...props}>
                          {children}
                        </code>
                      );
                    }
                  }}
                >
                  {m.content}
                </ReactMarkdown>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 bg-vscode-bg/80 backdrop-blur-md border-t border-vscode-border">
        <div className="relative group">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Type your command or question..."
            className="w-full bg-vscode-border/20 border border-vscode-border group-focus-within:border-fuelix-purple/50 rounded-xl py-3 pl-4 pr-12 text-sm outline-none transition-all resize-none min-h-[50px] max-h-[200px]"
            rows={1}
          />
          <button 
            onClick={handleSend}
            disabled={!input.trim() || isStreaming}
            className="absolute right-2 bottom-2.5 p-2 bg-fuelix-purple hover:bg-fuelix-purple/90 disabled:opacity-30 rounded-lg transition-all shadow-lg shadow-fuelix-purple/20"
          >
            {isStreaming ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Send className="w-4 h-4 text-white" />}
          </button>
        </div>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          {['/explain', '/debug', '/refactor', '/test', '/terminal'].map(cmd => (
            <button 
              key={cmd}
              onClick={() => setInput(cmd + ' ')}
              className="text-[10px] px-2 py-1 rounded-full bg-vscode-border/40 hover:bg-fuelix-purple/20 border border-vscode-border hover:border-fuelix-purple/30 transition-all font-mono whitespace-nowrap"
            >
              {cmd}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function clsx(...classes: any[]) {
  return classes.filter(Boolean).join(' ');
}
