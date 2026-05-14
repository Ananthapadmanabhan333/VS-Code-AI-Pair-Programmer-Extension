import * as vscode from 'vscode';
import { AIOrchestrator } from '../core/AIOrchestrator';
import { ContextEngine } from '../core/ContextEngine';
import { CompletionRequest } from '../types';
import { Logger } from '../utils/Logger';

export class CompletionProvider implements vscode.InlineCompletionItemProvider {
  private logger = Logger.getInstance('CompletionProvider');
  private debounceTimer: NodeJS.Timeout | null = null;
  private pendingRequest: Promise<vscode.InlineCompletionList | null> | null = null;
  private cache: Map<string, { text: string; timestamp: number }> = new Map();
  private readonly CACHE_TTL_MS = 30_000;
  private readonly MAX_CACHE_SIZE = 50;

  constructor(
    private context: vscode.ExtensionContext,
    private orchestrator: AIOrchestrator,
    private contextEngine: ContextEngine
  ) {}

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionList | null> {
    const config = vscode.workspace.getConfiguration('fuelix');
    if (!config.get<boolean>('enableInlineCompletions', true)) return null;

    // Don't trigger on very short lines or empty files
    const lineText = document.lineAt(position).text;
    const prefix = document.getText(new vscode.Range(
      new vscode.Position(Math.max(0, position.line - 50), 0),
      position
    ));

    if (prefix.trim().length < 5) return null;

    // Check cache
    const cacheKey = this.getCacheKey(document.uri.fsPath, position, prefix);
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      return this.wrapCompletion(cached.text, position);
    }

    // Debounce
    const debounceMs = config.get<number>('completionDebounceMs', 300);
    await this.delay(debounceMs);
    if (token.isCancellationRequested) return null;

    const suffix = document.getText(new vscode.Range(
      position,
      new vscode.Position(Math.min(document.lineCount - 1, position.line + 20), 0)
    ));

    const request: CompletionRequest = {
      prefix,
      suffix,
      fileName: document.uri.fsPath,
      languageId: document.languageId,
      position,
    };

    try {
      const result = await this.orchestrator.requestCompletion(request);
      if (token.isCancellationRequested) return null;
      if (!result || !result.text.trim()) return null;

      // Cache the result
      this.setCache(cacheKey, result.text);

      return this.wrapCompletion(result.text, position);
    } catch (error) {
      if (!token.isCancellationRequested) {
        this.logger.debug('Completion provider error', error);
      }
      return null;
    }
  }

  private wrapCompletion(text: string, position: vscode.Position): vscode.InlineCompletionList {
    const item = new vscode.InlineCompletionItem(text);
    item.range = new vscode.Range(position, position);
    return { items: [item] };
  }

  private getCacheKey(filePath: string, position: vscode.Position, prefix: string): string {
    // Use last 200 chars of prefix as cache discriminator
    const prefixKey = prefix.slice(-200).replace(/\s+/g, ' ');
    return `${filePath}:${position.line}:${prefixKey}`;
  }

  private setCache(key: string, text: string): void {
    if (this.cache.size >= this.MAX_CACHE_SIZE) {
      // Evict oldest
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    this.cache.set(key, { text, timestamp: Date.now() });
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
