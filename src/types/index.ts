import * as vscode from 'vscode';

export interface CodeChunk {
  id?: number;
  filePath: string;
  content: string;
  startLine: number;
  endLine: number;
  chunkType: 'function' | 'class' | 'block' | 'generic';
  language?: string;
  keywords?: string[];
  score?: number;
}

export interface RetrievedContext {
  filePath: string;
  content: string;
  score: number;
  chunkType: string;
  startLine: number;
  endLine: number;
}

export interface StoredMemory {
  id?: number;
  type: string;
  summary: string;
  content?: string;
  workspacePath?: string;
  relevanceScore?: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
  id?: string;
}

export interface CompletionRequest {
  prefix: string;
  suffix: string;
  fileName: string;
  languageId: string;
  position: vscode.Position;
}

export interface CompletionResult {
  text: string;
  model: string;
  latencyMs: number;
  tokenCount: number;
}

export interface AgentTask {
  type: 'completion' | 'debug' | 'refactor' | 'architecture' | 'documentation' | 'terminal' | 'test' | 'security' | 'chat';
  instruction: string;
  code?: string;
  language?: string;
  codeContext?: string;
}

export interface AgentResult {
  agentId: string;
  type: string;
  response: string;
  latencyMs: number;
  success: boolean;
  error?: string;
}

export interface ModelConfig {
  model: string;
  completionModel: string;
  maxContextTokens: number;
  streaming: boolean;
}

export type StreamCallback = (delta: string) => void;

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  workspacePath?: string;
}
