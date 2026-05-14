import * as vscode from 'vscode';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { ContextEngine } from './ContextEngine';
import { ObservabilityService } from '../services/ObservabilityService';
import { SecretStore } from '../services/SecretStore';
import { Logger } from '../utils/Logger';
import { TokenCounter } from '../utils/TokenCounter';
import {
  ChatMessage,
  CompletionRequest,
  CompletionResult,
  AgentTask,
  AgentResult,
  ModelConfig,
  StreamCallback,
} from '../types';

export type AgentType =
  | 'completion'
  | 'debug'
  | 'refactor'
  | 'architecture'
  | 'documentation'
  | 'terminal'
  | 'test'
  | 'security'
  | 'chat';

interface ActiveAgent {
  id: string;
  type: AgentType;
  startTime: number;
  status: 'running' | 'completed' | 'failed';
  cancelToken: vscode.CancellationTokenSource;
}

export class AIOrchestrator {
  private logger = Logger.getInstance('AIOrchestrator');
  private openai: OpenAI | null = null;
  private anthropic: Anthropic | null = null;
  private activeAgents: Map<string, ActiveAgent> = new Map();
  private requestQueue: Array<() => Promise<void>> = [];
  private isProcessingQueue = false;

  constructor(
    private context: vscode.ExtensionContext,
    private secretStore: SecretStore,
    private contextEngine: ContextEngine,
    private observability: ObservabilityService
  ) {
    this.initializeClients();
  }

  private async initializeClients(): Promise<void> {
    try {
      const openaiKey = await this.secretStore.getOpenAIKey();
      if (openaiKey) {
        this.openai = new OpenAI({ apiKey: openaiKey });
      }

      const anthropicKey = await this.secretStore.getAnthropicKey();
      if (anthropicKey) {
        this.anthropic = new Anthropic({ apiKey: anthropicKey });
      }
    } catch (error) {
      this.logger.error('Failed to initialize AI clients', error);
    }
  }

  public handleConfigChange(): void {
    this.openai = null;
    this.anthropic = null;
    this.initializeClients();
  }

  private getModelConfig(): ModelConfig {
    const config = vscode.workspace.getConfiguration('fuelix');
    return {
      model: config.get<string>('model', 'gpt-4o'),
      completionModel: config.get<string>('completionModel', 'gpt-4o-mini'),
      maxContextTokens: config.get<number>('contextWindowSize', 8000),
      streaming: config.get<boolean>('streamingEnabled', true),
    };
  }

  private isOpenAIModel(model: string): boolean {
    return model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3');
  }

  private isAnthropicModel(model: string): boolean {
    return model.startsWith('claude-');
  }

  // ─── Inline Completion Agent ───────────────────────────────────────────────
  async requestCompletion(request: CompletionRequest): Promise<CompletionResult | null> {
    const config = this.getModelConfig();
    const startTime = Date.now();

    if (!(await this.ensureClient(config.completionModel))) {
      return null;
    }

    try {
      const context = await this.contextEngine.buildCompletionContext(request);
      const prompt = this.buildCompletionPrompt(request, context);
      const tokenCount = TokenCounter.count(prompt);

      this.logger.debug(`Completion request: ${tokenCount} tokens`);

      let completion: string;

      if (this.isOpenAIModel(config.completionModel) && this.openai) {
        const response = await this.openai.chat.completions.create({
          model: config.completionModel,
          messages: [
            {
              role: 'system',
              content: this.getCompletionSystemPrompt(request.languageId),
            },
            { role: 'user', content: prompt },
          ],
          max_tokens: vscode.workspace.getConfiguration('fuelix').get('maxCompletionTokens', 256),
          temperature: 0.1,
          stop: ['\n\n\n', '```'],
        });
        completion = response.choices[0]?.message?.content ?? '';
      } else if (this.isAnthropicModel(config.completionModel) && this.anthropic) {
        const response = await this.anthropic.messages.create({
          model: config.completionModel,
          max_tokens: 256,
          temperature: 0.1,
          system: this.getCompletionSystemPrompt(request.languageId),
          messages: [{ role: 'user', content: prompt }],
        });
        completion = response.content[0].type === 'text' ? response.content[0].text : '';
      } else {
        return null;
      }

      const latency = Date.now() - startTime;
      this.observability.trackCompletion({ latency, tokenCount, model: config.completionModel });

      return {
        text: completion.trim(),
        model: config.completionModel,
        latencyMs: latency,
        tokenCount,
      };
    } catch (error) {
      this.logger.error('Completion request failed', error);
      this.observability.trackError('completion_failed', error as Error);
      return null;
    }
  }

  // ─── Chat Agent ────────────────────────────────────────────────────────────
  async chat(
    messages: ChatMessage[],
    systemPrompt: string,
    onStream: StreamCallback,
    cancelToken?: vscode.CancellationToken
  ): Promise<string> {
    const config = this.getModelConfig();
    const agentId = this.createAgent('chat');
    const startTime = Date.now();

    if (!(await this.ensureClient(config.model))) {
      throw new Error('No AI client configured. Please set your API key.');
    }

    try {
      let fullResponse = '';

      if (this.isOpenAIModel(config.model) && this.openai) {
        const stream = await this.openai.chat.completions.create({
          model: config.model,
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
          ],
          stream: true,
          temperature: 0.7,
          max_tokens: 4096,
        });

        for await (const chunk of stream) {
          if (cancelToken?.isCancellationRequested) {
            stream.controller.abort();
            break;
          }
          const delta = chunk.choices[0]?.delta?.content ?? '';
          if (delta) {
            fullResponse += delta;
            onStream(delta);
          }
        }
      } else if (this.isAnthropicModel(config.model) && this.anthropic) {
        const anthropicMessages = messages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));

        const stream = await this.anthropic.messages.stream({
          model: config.model,
          max_tokens: 4096,
          system: systemPrompt,
          messages: anthropicMessages,
        });

        for await (const chunk of stream) {
          if (cancelToken?.isCancellationRequested) break;
          if (
            chunk.type === 'content_block_delta' &&
            chunk.delta.type === 'text_delta'
          ) {
            fullResponse += chunk.delta.text;
            onStream(chunk.delta.text);
          }
        }
      }

      const latency = Date.now() - startTime;
      this.completeAgent(agentId);
      this.observability.trackChat({ latency, model: config.model });

      return fullResponse;
    } catch (error) {
      this.failAgent(agentId);
      this.logger.error('Chat request failed', error);
      throw error;
    }
  }

  // ─── Agent Task Runner ─────────────────────────────────────────────────────
  async runAgentTask(task: AgentTask): Promise<AgentResult> {
    const agentId = this.createAgent(task.type);
    const startTime = Date.now();
    const config = this.getModelConfig();

    if (!(await this.ensureClient(config.model))) {
      throw new Error('No AI client configured. Please set your API key.');
    }

    try {
      const systemPrompt = this.getAgentSystemPrompt(task.type);
      const contextChunks = await this.contextEngine.retrieveContext(task.codeContext ?? '');
      const contextBlock = contextChunks.slice(0, 5).map((c) => c.content).join('\n\n---\n\n');

      const userPrompt = `
${task.instruction}

${task.code ? `## Code to Analyze:\n\`\`\`${task.language ?? ''}\n${task.code}\n\`\`\`` : ''}

${contextBlock ? `## Relevant Repository Context:\n${contextBlock}` : ''}
`.trim();

      let response = '';

      if (this.isOpenAIModel(config.model) && this.openai) {
        const result = await this.openai.chat.completions.create({
          model: config.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.3,
          max_tokens: 4096,
        });
        response = result.choices[0]?.message?.content ?? '';
      } else if (this.isAnthropicModel(config.model) && this.anthropic) {
        const result = await this.anthropic.messages.create({
          model: config.model,
          max_tokens: 4096,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        });
        response = result.content[0].type === 'text' ? result.content[0].text : '';
      }

      const latency = Date.now() - startTime;
      this.completeAgent(agentId);
      this.observability.trackAgentTask({ type: task.type, latency, model: config.model });

      return {
        agentId,
        type: task.type,
        response,
        latencyMs: latency,
        success: true,
      };
    } catch (error) {
      this.failAgent(agentId);
      this.logger.error(`Agent task (${task.type}) failed`, error);
      throw error;
    }
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────
  private async ensureClient(model: string): Promise<boolean> {
    if (this.isOpenAIModel(model) && this.openai) return true;
    if (this.isAnthropicModel(model) && this.anthropic) return true;
    // Try re-init
    await this.initializeClients();
    return !!(this.openai || this.anthropic);
  }

  private createAgent(type: AgentType): string {
    const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const cancelToken = new vscode.CancellationTokenSource();
    this.activeAgents.set(id, {
      id,
      type,
      startTime: Date.now(),
      status: 'running',
      cancelToken,
    });
    return id;
  }

  private completeAgent(id: string): void {
    const agent = this.activeAgents.get(id);
    if (agent) {
      agent.status = 'completed';
      setTimeout(() => this.activeAgents.delete(id), 5000);
    }
  }

  private failAgent(id: string): void {
    const agent = this.activeAgents.get(id);
    if (agent) {
      agent.status = 'failed';
      setTimeout(() => this.activeAgents.delete(id), 5000);
    }
  }

  public getActiveAgents(): ActiveAgent[] {
    return Array.from(this.activeAgents.values());
  }

  private buildCompletionPrompt(request: CompletionRequest, context: string): string {
    return `
## File: ${request.fileName}
## Language: ${request.languageId}
## Cursor Position: Line ${request.position.line + 1}

### Repository Context:
${context}

### Code Before Cursor:
\`\`\`${request.languageId}
${request.prefix}
\`\`\`

### Code After Cursor:
\`\`\`${request.languageId}
${request.suffix}
\`\`\`

Complete the code at the cursor position. Output ONLY the completion text, no explanations:`.trim();
  }

  private getCompletionSystemPrompt(languageId: string): string {
    return `You are an expert ${languageId} programmer providing inline code completions. 
Rules:
- Output ONLY the code completion, no explanations, no markdown
- Continue naturally from where the cursor is
- Match the existing code style, indentation, and patterns
- Keep completions concise unless a full function/class is needed
- Be aware of imports, types, and surrounding context
- Prefer idiomatic ${languageId} patterns`;
  }

  private getAgentSystemPrompt(type: AgentType): string {
    const prompts: Record<AgentType, string> = {
      completion: `You are an elite code completion AI. Generate precise, context-aware code completions.`,
      debug: `You are an expert debugging engineer. Analyze code for bugs, explain root causes clearly, and provide exact fixes with before/after diffs. Be specific about line numbers and error causes.`,
      refactor: `You are a senior software architect specializing in code quality. Provide concrete refactoring suggestions with complete rewritten code. Focus on SOLID principles, performance, and maintainability.`,
      architecture: `You are a principal software architect. Analyze code architecture, identify patterns and anti-patterns, and provide actionable structural improvements with diagrams in text form.`,
      documentation: `You are a technical documentation expert. Generate comprehensive, developer-friendly documentation. Include JSDoc/docstrings, README sections, API docs, and inline comments.`,
      terminal: `You are a DevOps and shell expert. Help with terminal commands, explain errors, generate scripts. Always warn about dangerous operations. Support bash, zsh, PowerShell.`,
      test: `You are a test engineering expert. Generate comprehensive unit tests, integration tests, and e2e tests. Use the appropriate testing framework for the language/stack. Aim for high coverage.`,
      security: `You are a security engineer. Identify OWASP vulnerabilities, injection attacks, data exposure risks, and insecure patterns. Provide specific remediation code.`,
      chat: `You are Fuelix AI, an elite AI pair programmer. You have deep knowledge of software engineering, architecture, DevOps, and all major languages and frameworks. Be precise, helpful, and proactive.`,
    };
    return prompts[type] ?? prompts.chat;
  }
}
