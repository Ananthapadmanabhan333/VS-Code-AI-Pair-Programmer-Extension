import * as vscode from 'vscode';
import { DatabaseService } from '../services/DatabaseService';
import { Logger } from '../utils/Logger';
import { StoredMemory } from '../types';

export interface MemoryEntry {
  id: number;
  type: string;
  summary: string;
  content?: string;
  workspacePath?: string;
  relevanceScore: number;
  createdAt: string;
}

export class MemorySystem {
  private logger = Logger.getInstance('MemorySystem');
  private workspacePath: string;
  private cache: Map<number, MemoryEntry> = new Map();

  constructor(
    private context: vscode.ExtensionContext,
    private db: DatabaseService
  ) {
    this.workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? 'global';
  }

  async initialize(): Promise<void> {
    // Pre-warm cache with recent memories
    const memories = this.db.getAllMemories(20);
    for (const m of memories) {
      this.cache.set(m.id!, {
        id: m.id!,
        type: m.type,
        summary: m.summary,
        content: m.content,
        workspacePath: m.workspacePath,
        relevanceScore: m.relevanceScore ?? 1.0,
        createdAt: (m as any).created_at ?? new Date().toISOString(),
      });
    }
    this.logger.info(`Memory system initialized with ${memories.length} entries`);
  }

  async remember(
    summary: string,
    content: string,
    type: 'preference' | 'pattern' | 'conversation' | 'error' | 'architecture' = 'conversation'
  ): Promise<number> {
    const memory: StoredMemory = {
      type,
      summary,
      content,
      workspacePath: this.workspacePath,
      relevanceScore: 1.0,
    };

    const id = this.db.saveMemory(memory);
    this.cache.set(id, {
      id,
      type,
      summary,
      content,
      workspacePath: this.workspacePath,
      relevanceScore: 1.0,
      createdAt: new Date().toISOString(),
    });

    return id;
  }

  async retrieveRelevant(query: string, topK = 5): Promise<MemoryEntry[]> {
    const results = this.db.searchMemory(query, topK);
    return results.map((m) => ({
      id: m.id!,
      type: m.type,
      summary: m.summary,
      content: m.content,
      workspacePath: m.workspacePath,
      relevanceScore: m.relevanceScore ?? 1.0,
      createdAt: (m as any).created_at ?? '',
    }));
  }

  async getAllMemories(): Promise<MemoryEntry[]> {
    const results = this.db.getAllMemories(100);
    return results.map((m) => ({
      id: m.id!,
      type: m.type,
      summary: m.summary,
      content: m.content,
      workspacePath: m.workspacePath,
      relevanceScore: m.relevanceScore ?? 1.0,
      createdAt: (m as any).created_at ?? '',
    }));
  }

  async delete(id: number): Promise<void> {
    this.db.deleteMemory(id);
    this.cache.delete(id);
  }

  async clearAll(): Promise<void> {
    this.db.clearAllMemory();
    this.cache.clear();
  }

  // Auto-extract memories from conversations
  async extractAndSaveFromConversation(
    userMessage: string,
    aiResponse: string
  ): Promise<void> {
    // Look for preference signals
    const preferencePatterns = [
      /I (prefer|always|usually|like to) (.+)/i,
      /we (use|follow|prefer) (.+) pattern/i,
      /our (convention|standard|style) is (.+)/i,
    ];

    for (const pattern of preferencePatterns) {
      const match = userMessage.match(pattern);
      if (match) {
        await this.remember(
          `Developer preference: ${match[0]}`,
          `User said: "${match[0]}" in context of: ${userMessage.slice(0, 200)}`,
          'preference'
        );
      }
    }

    // Save significant conversations (long responses)
    if (aiResponse.length > 500 && userMessage.length > 30) {
      await this.remember(
        `Conversation: ${userMessage.slice(0, 100)}`,
        `Q: ${userMessage.slice(0, 300)}\n\nA: ${aiResponse.slice(0, 500)}`,
        'conversation'
      );
    }
  }
}
