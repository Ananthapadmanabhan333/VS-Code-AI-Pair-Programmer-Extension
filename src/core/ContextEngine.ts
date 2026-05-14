import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { DatabaseService } from '../services/DatabaseService';
import { MemorySystem } from './MemorySystem';
import { Logger } from '../utils/Logger';
import { CodeChunk, RetrievedContext } from '../types';
import { TokenCounter } from '../utils/TokenCounter';

export class ContextEngine {
  private logger = Logger.getInstance('ContextEngine');
  private recentFiles: string[] = [];
  private openTabFiles: string[] = [];
  private activeFileContent: string = '';
  private activeFilePath: string = '';

  constructor(
    private context: vscode.ExtensionContext,
    private memory: MemorySystem,
    private db: DatabaseService
  ) {
    this.initializeOpenTabs();
  }

  private initializeOpenTabs(): void {
    this.openTabFiles = vscode.workspace.textDocuments
      .filter((d) => !d.isUntitled && d.uri.scheme === 'file')
      .map((d) => d.uri.fsPath);
  }

  // ─── Editor Event Handlers ─────────────────────────────────────────────────
  handleDocumentOpen(doc: vscode.TextDocument): void {
    if (doc.uri.scheme === 'file') {
      this.addRecentFile(doc.uri.fsPath);
      if (!this.openTabFiles.includes(doc.uri.fsPath)) {
        this.openTabFiles.push(doc.uri.fsPath);
        if (this.openTabFiles.length > 20) this.openTabFiles.shift();
      }
    }
  }

  handleDocumentChange(event: vscode.TextDocumentChangeEvent): void {
    if (event.document.uri.fsPath === this.activeFilePath) {
      this.activeFileContent = event.document.getText();
    }
  }

  handleEditorChange(editor: vscode.TextEditor): void {
    this.activeFilePath = editor.document.uri.fsPath;
    this.activeFileContent = editor.document.getText();
    this.addRecentFile(this.activeFilePath);
  }

  private addRecentFile(filePath: string): void {
    this.recentFiles = [filePath, ...this.recentFiles.filter((f) => f !== filePath)].slice(0, 10);
  }

  // ─── Completion Context Builder ────────────────────────────────────────────
  async buildCompletionContext(request: {
    prefix: string;
    suffix: string;
    fileName: string;
    languageId: string;
    position: vscode.Position;
  }): Promise<string> {
    const maxTokens = 2000;
    const parts: string[] = [];

    // 1. Include open tab summaries
    const tabContext = await this.getOpenTabContext(3, request.fileName);
    if (tabContext) parts.push(`### Open Files Context:\n${tabContext}`);

    // 2. Include recent file summaries
    const recentContext = await this.getRecentFilesContext(2, request.fileName);
    if (recentContext) parts.push(`### Recent Files:\n${recentContext}`);

    // 3. Retrieve semantically similar code from index
    const queryText = request.prefix.split('\n').slice(-20).join('\n');
    const retrieved = await this.retrieveContext(queryText, 3);
    if (retrieved.length > 0) {
      const retrievedText = retrieved.map((r) => `// ${r.filePath}\n${r.content}`).join('\n\n');
      parts.push(`### Related Code:\n${retrievedText}`);
    }

    const combined = parts.join('\n\n');
    return this.truncateToTokens(combined, maxTokens);
  }

  // ─── Chat Context Builder ──────────────────────────────────────────────────
  async buildChatContext(userMessage: string): Promise<string> {
    const maxTokens = 6000;
    const parts: string[] = [];

    // 1. Active file
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      const content = editor.document.getText();
      const selection = editor.selection;
      if (!selection.isEmpty) {
        const selectedText = editor.document.getText(selection);
        parts.push(`### Selected Code (${editor.document.languageId}):\n\`\`\`${editor.document.languageId}\n${selectedText}\n\`\`\``);
      } else {
        const truncated = this.truncateToTokens(content, 1500);
        parts.push(`### Active File (${path.basename(editor.document.uri.fsPath)}):\n\`\`\`${editor.document.languageId}\n${truncated}\n\`\`\``);
      }
    }

    // 2. Semantic retrieval
    const retrieved = await this.retrieveContext(userMessage, 5);
    if (retrieved.length > 0) {
      const chunks = retrieved
        .slice(0, 4)
        .map((r) => `// File: ${path.relative(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '', r.filePath)}\n${r.content}`)
        .join('\n\n---\n\n');
      parts.push(`### Relevant Repository Code:\n${chunks}`);
    }

    // 3. Project structure
    const structure = await this.getProjectStructure();
    if (structure) parts.push(`### Project Structure:\n${structure}`);

    // 4. Memory context
    const memories = await this.memory.retrieveRelevant(userMessage, 3);
    if (memories.length > 0) {
      const memText = memories.map((m) => `- ${m.summary}`).join('\n');
      parts.push(`### Remembered Context:\n${memText}`);
    }

    return this.truncateToTokens(parts.join('\n\n'), maxTokens);
  }

  // ─── Semantic Retrieval ────────────────────────────────────────────────────
  async retrieveContext(query: string, topK = 5): Promise<RetrievedContext[]> {
    try {
      const chunks = await this.db.searchChunks(query, topK);
      return chunks.map((chunk) => ({
        filePath: chunk.filePath,
        content: chunk.content,
        score: chunk.score,
        chunkType: chunk.chunkType,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
      }));
    } catch (error) {
      this.logger.error('Context retrieval failed', error);
      return [];
    }
  }

  // ─── Project Structure ─────────────────────────────────────────────────────
  async getProjectStructure(maxDepth = 3): Promise<string> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) return '';

    try {
      const lines = this.buildTree(root, root, 0, maxDepth);
      return lines.slice(0, 80).join('\n');
    } catch {
      return '';
    }
  }

  private buildTree(root: string, dir: string, depth: number, maxDepth: number): string[] {
    if (depth > maxDepth) return [];

    const ignoreDirs = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', 'venv', '.venv']);
    const lines: string[] = [];
    const indent = '  '.repeat(depth);

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries.slice(0, 30)) {
        if (ignoreDirs.has(entry.name) || entry.name.startsWith('.')) continue;
        const relPath = path.relative(root, path.join(dir, entry.name));
        if (entry.isDirectory()) {
          lines.push(`${indent}📁 ${entry.name}/`);
          lines.push(...this.buildTree(root, path.join(dir, entry.name), depth + 1, maxDepth));
        } else {
          lines.push(`${indent}📄 ${entry.name}`);
        }
      }
    } catch { /* ignore */ }

    return lines;
  }

  // ─── Helper Methods ────────────────────────────────────────────────────────
  private async getOpenTabContext(maxFiles: number, exclude: string): Promise<string> {
    const tabs = this.openTabFiles
      .filter((f) => f !== exclude)
      .slice(0, maxFiles);

    const parts: string[] = [];
    for (const filePath of tabs) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const ext = path.extname(filePath).slice(1);
        const truncated = this.truncateToTokens(content, 300);
        parts.push(`// ${path.basename(filePath)}\n\`\`\`${ext}\n${truncated}\n\`\`\``);
      } catch { /* skip unreadable files */ }
    }

    return parts.join('\n\n');
  }

  private async getRecentFilesContext(maxFiles: number, exclude: string): Promise<string> {
    const files = this.recentFiles.filter((f) => f !== exclude).slice(0, maxFiles);
    const parts: string[] = [];

    for (const filePath of files) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const ext = path.extname(filePath).slice(1);
        const truncated = this.truncateToTokens(content, 200);
        parts.push(`// ${path.basename(filePath)}\n${truncated}`);
      } catch { /* skip */ }
    }

    return parts.join('\n\n');
  }

  private truncateToTokens(text: string, maxTokens: number): string {
    const tokens = TokenCounter.count(text);
    if (tokens <= maxTokens) return text;

    // Rough truncation: ~4 chars per token
    const charLimit = maxTokens * 4;
    return text.slice(0, charLimit) + '\n... (truncated)';
  }

  getOpenTabFiles(): string[] { return [...this.openTabFiles]; }
  getRecentFiles(): string[] { return [...this.recentFiles]; }
  getActiveFilePath(): string { return this.activeFilePath; }
}
