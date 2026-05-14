import * as vscode from 'vscode';
import { DatabaseService } from './DatabaseService';
import { Logger } from '../utils/Logger';

interface CompletionMetric {
  latency: number;
  tokenCount: number;
  model: string;
}

interface ChatMetric {
  latency: number;
  model: string;
}

interface AgentTaskMetric {
  type: string;
  latency: number;
  model: string;
}

export class ObservabilityService {
  private logger = Logger.getInstance('Observability');
  private chatSessionCount = 0;
  private memoryCount = 0;

  constructor(
    private context: vscode.ExtensionContext,
    private db: DatabaseService
  ) {}

  trackCompletion(metric: CompletionMetric): void {
    this.db.trackCompletion(metric.latency, metric.tokenCount, metric.model);
    this.logger.debug(`Completion: ${metric.latency}ms, ${metric.tokenCount} tokens`);
  }

  trackChat(metric: ChatMetric): void {
    this.chatSessionCount++;
    this.db.trackEvent('chat.response', metric);
    this.logger.debug(`Chat response: ${metric.latency}ms`);
  }

  trackAgentTask(metric: AgentTaskMetric): void {
    this.db.trackEvent(`agent.${metric.type}`, metric);
    this.logger.debug(`Agent (${metric.type}): ${metric.latency}ms`);
  }

  trackError(errorType: string, error: Error): void {
    this.db.trackEvent('error', {
      errorType,
      message: error.message,
      stack: error.stack?.slice(0, 500),
    });
    this.logger.error(`[${errorType}] ${error.message}`);
  }

  trackEvent(eventType: string, properties?: Record<string, any>): void {
    this.db.trackEvent(eventType, properties);
  }

  getStats(): {
    totalCompletions: number;
    avgLatency: number;
    memoryCount: number;
    chatSessions: number;
  } {
    const completionStats = this.db.getCompletionStats();
    return {
      totalCompletions: completionStats.totalCompletions,
      avgLatency: completionStats.avgLatency,
      memoryCount: this.memoryCount,
      chatSessions: this.chatSessionCount,
    };
  }

  updateMemoryCount(count: number): void {
    this.memoryCount = count;
  }
}
