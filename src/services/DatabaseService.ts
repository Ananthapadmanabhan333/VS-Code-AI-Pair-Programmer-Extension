import * as vscode from 'vscode';
import * as path from 'path';
import Database from 'better-sqlite3';
import { CodeChunk, StoredMemory } from '../types';
import { Logger } from '../utils/Logger';

// @ts-ignore
declare module 'better-sqlite3';

export class DatabaseService {
  private logger = Logger.getInstance('DatabaseService');
  private db!: Database.Database;

  constructor(private context: vscode.ExtensionContext) {}

  async initialize(): Promise<void> {
    const dbPath = path.join(this.context.globalStorageUri.fsPath, 'fuelix.db');
    
    // Ensure directory exists
    const dir = path.dirname(dbPath);
    const fs = await import('fs');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('temp_store = MEMORY');
    this.db.pragma('mmap_size = 268435456'); // 256MB mmap

    this.createSchema();
    this.logger.info(`Database initialized at ${dbPath}`);
  }

  private createSchema(): void {
    this.db.exec(`
      -- Code chunks for RAG retrieval
      CREATE TABLE IF NOT EXISTS code_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL,
        content TEXT NOT NULL,
        start_line INTEGER,
        end_line INTEGER,
        chunk_type TEXT DEFAULT 'generic',
        language TEXT,
        keywords TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_chunks_file ON code_chunks(file_path);
      CREATE INDEX IF NOT EXISTS idx_chunks_language ON code_chunks(language);

      -- Full-text search for chunks
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        content,
        keywords,
        file_path UNINDEXED,
        chunk_id UNINDEXED,
        tokenize='porter unicode61'
      );

      -- AI Memory (persistent conversation context)
      CREATE TABLE IF NOT EXISTS ai_memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        summary TEXT NOT NULL,
        content TEXT,
        relevance_score REAL DEFAULT 1.0,
        workspace_path TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_accessed DATETIME DEFAULT CURRENT_TIMESTAMP,
        access_count INTEGER DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_memory_type ON ai_memory(type);
      CREATE INDEX IF NOT EXISTS idx_memory_workspace ON ai_memory(workspace_path);

      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        summary,
        content,
        memory_id UNINDEXED,
        tokenize='porter unicode61'
      );

      -- Conversation history
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        workspace_path TEXT
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        model TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(conversation_id) REFERENCES conversations(id)
      );

      CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);

      -- Observability events
      CREATE TABLE IF NOT EXISTS telemetry_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        properties TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Completion metrics
      CREATE TABLE IF NOT EXISTS completion_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        latency_ms INTEGER,
        token_count INTEGER,
        model TEXT,
        accepted INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Settings cache
      CREATE TABLE IF NOT EXISTS settings_cache (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  // ─── Code Chunks ──────────────────────────────────────────────────────────
  upsertChunks(chunks: CodeChunk[]): void {
    const deleteStmt = this.db.prepare(`DELETE FROM code_chunks WHERE file_path = ?`);
    const deleteFtsStmt = this.db.prepare(`DELETE FROM chunks_fts WHERE file_path = ?`);
    const insertStmt = this.db.prepare(`
      INSERT INTO code_chunks (file_path, content, start_line, end_line, chunk_type, language, keywords)
      VALUES (@filePath, @content, @startLine, @endLine, @chunkType, @language, @keywords)
    `);
    const insertFtsStmt = this.db.prepare(`
      INSERT INTO chunks_fts (content, keywords, file_path, chunk_id)
      VALUES (@content, @keywords, @filePath, @chunkId)
    `);

    const upsertMany = this.db.transaction((chunkList: CodeChunk[]) => {
      if (chunkList.length === 0) return;
      const filePath = chunkList[0].filePath;
      deleteStmt.run(filePath);
      deleteFtsStmt.run(filePath);

      for (const chunk of chunkList) {
        const result = insertStmt.run({
          filePath: chunk.filePath,
          content: chunk.content,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          chunkType: chunk.chunkType,
          language: chunk.language,
          keywords: chunk.keywords?.join(' ') ?? '',
        });
        insertFtsStmt.run({
          content: chunk.content,
          keywords: chunk.keywords?.join(' ') ?? '',
          filePath: chunk.filePath,
          chunkId: result.lastInsertRowid,
        });
      }
    });

    upsertMany(chunks);
  }

  searchChunks(query: string, topK = 5): Array<CodeChunk & { score: number }> {
    try {
      const stmt = this.db.prepare(`
        SELECT 
          c.file_path as filePath,
          c.content,
          c.start_line as startLine,
          c.end_line as endLine,
          c.chunk_type as chunkType,
          c.language,
          c.keywords,
          rank as score
        FROM chunks_fts
        JOIN code_chunks c ON c.id = chunks_fts.chunk_id
        WHERE chunks_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `);
      
      // Sanitize query for FTS5
      const sanitized = query
        .replace(/[^a-zA-Z0-9\s_]/g, ' ')
        .trim()
        .split(/\s+/)
        .filter((w) => w.length > 2)
        .slice(0, 10)
        .join(' OR ');

      if (!sanitized) return [];

      const rows = stmt.all(sanitized, topK) as any[];
      return rows.map((r) => ({
        filePath: r.filePath,
        content: r.content,
        startLine: r.startLine,
        endLine: r.endLine,
        chunkType: r.chunkType,
        language: r.language,
        keywords: typeof r.keywords === 'string' ? r.keywords.split(' ') : [],
        score: Math.abs(r.score as number),
      }));
    } catch (error) {
      this.logger.debug('FTS search error, falling back to LIKE', error);
      return this.fallbackSearch(query, topK);
    }
  }

  private fallbackSearch(query: string, topK: number): Array<CodeChunk & { score: number }> {
    const words = query.split(/\s+/).filter((w) => w.length > 3).slice(0, 5);
    if (words.length === 0) return [];
    
    const likeClause = words.map(() => `content LIKE ?`).join(' OR ');
    const params = words.map((w) => `%${w}%`);
    
    const stmt = this.db.prepare(`
      SELECT file_path as filePath, content, start_line as startLine, 
             end_line as endLine, chunk_type as chunkType, language, keywords
      FROM code_chunks
      WHERE ${likeClause}
      LIMIT ?
    `);
    
    return (stmt.all([...params, topK]) as CodeChunk[]).map((r) => ({ ...r, score: 1.0 }));
  }

  // ─── Memory ───────────────────────────────────────────────────────────────
  saveMemory(memory: StoredMemory): number {
    const stmt = this.db.prepare(`
      INSERT INTO ai_memory (type, summary, content, workspace_path, relevance_score)
      VALUES (@type, @summary, @content, @workspacePath, @relevanceScore)
    `);
    const ftsStmt = this.db.prepare(`
      INSERT INTO memory_fts (summary, content, memory_id)
      VALUES (@summary, @content, @memoryId)
    `);

    const result = stmt.run({
      type: memory.type,
      summary: memory.summary,
      content: memory.content ?? null,
      workspacePath: memory.workspacePath ?? null,
      relevanceScore: memory.relevanceScore ?? 1.0,
    });

    ftsStmt.run({
      summary: memory.summary,
      content: memory.content ?? '',
      memoryId: result.lastInsertRowid,
    });

    return Number(result.lastInsertRowid);
  }

  searchMemory(query: string, topK = 5): StoredMemory[] {
    try {
      const sanitized = query
        .replace(/[^a-zA-Z0-9\s_]/g, ' ')
        .trim()
        .split(/\s+/)
        .filter((w) => w.length > 2)
        .slice(0, 8)
        .join(' OR ');

      if (!sanitized) return [];

      const stmt = this.db.prepare(`
        SELECT m.* FROM memory_fts
        JOIN ai_memory m ON m.id = memory_fts.memory_id
        WHERE memory_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `);
      return stmt.all(sanitized, topK) as StoredMemory[];
    } catch {
      const stmt = this.db.prepare(`
        SELECT * FROM ai_memory
        WHERE summary LIKE ? 
        ORDER BY last_accessed DESC, relevance_score DESC
        LIMIT ?
      `);
      return stmt.all(`%${query.slice(0, 50)}%`, topK) as StoredMemory[];
    }
  }

  getAllMemories(limit = 50): StoredMemory[] {
    const stmt = this.db.prepare(`
      SELECT * FROM ai_memory ORDER BY last_accessed DESC, relevance_score DESC LIMIT ?
    `);
    return stmt.all(limit) as StoredMemory[];
  }

  deleteMemory(id: number): void {
    this.db.prepare(`DELETE FROM ai_memory WHERE id = ?`).run(id);
    this.db.prepare(`DELETE FROM memory_fts WHERE memory_id = ?`).run(id);
  }

  clearAllMemory(): void {
    this.db.exec(`DELETE FROM ai_memory; DELETE FROM memory_fts;`);
  }

  // ─── Conversations ────────────────────────────────────────────────────────
  saveConversation(id: string, title: string, workspacePath: string): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO conversations (id, title, workspace_path, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `).run(id, title, workspacePath);
  }

  saveMessage(convId: string, role: string, content: string, model?: string): void {
    this.db.prepare(`
      INSERT INTO messages (conversation_id, role, content, model)
      VALUES (?, ?, ?, ?)
    `).run(convId, role, content, model ?? null);
    this.db.prepare(`UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(convId);
  }

  getConversations(limit = 20, workspacePath?: string): any[] {
    if (workspacePath) {
      return this.db.prepare(`
        SELECT * FROM conversations WHERE workspace_path = ? ORDER BY updated_at DESC LIMIT ?
      `).all(workspacePath, limit) as any[];
    }
    return this.db.prepare(`
      SELECT * FROM conversations ORDER BY updated_at DESC LIMIT ?
    `).all(limit) as any[];
  }

  getMessages(convId: string): any[] {
    return this.db.prepare(`
      SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC
    `).all(convId) as any[];
  }

  // ─── Telemetry ────────────────────────────────────────────────────────────
  trackEvent(eventType: string, properties?: Record<string, any>): void {
    this.db.prepare(`
      INSERT INTO telemetry_events (event_type, properties) VALUES (?, ?)
    `).run(eventType, properties ? JSON.stringify(properties) : null);
  }

  trackCompletion(latencyMs: number, tokenCount: number, model: string): void {
    this.db.prepare(`
      INSERT INTO completion_metrics (latency_ms, token_count, model) VALUES (?, ?, ?)
    `).run(latencyMs, tokenCount, model);
  }

  getCompletionStats(): { avgLatency: number; totalCompletions: number; avgTokens: number } {
    const row = this.db.prepare(`
      SELECT AVG(latency_ms) as avgLatency, COUNT(*) as totalCompletions, AVG(token_count) as avgTokens
      FROM completion_metrics
      WHERE created_at > datetime('now', '-7 days')
    `).get() as any;
    return {
      avgLatency: Math.round(row?.avgLatency ?? 0),
      totalCompletions: row?.totalCompletions ?? 0,
      avgTokens: Math.round(row?.avgTokens ?? 0),
    };
  }

  // ─── Utility ──────────────────────────────────────────────────────────────
  close(): void {
    this.db?.close();
  }
}
