import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import ignore from 'ignore';
import { DatabaseService } from '../services/DatabaseService';
import { ContextEngine } from './ContextEngine';
import { Logger } from '../utils/Logger';
import { CodeChunk } from '../types';

const SUPPORTED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.pyi',
  '.go',
  '.rs',
  '.java', '.kt',
  '.c', '.cpp', '.h', '.hpp',
  '.cs',
  '.rb',
  '.php',
  '.swift',
  '.vue', '.svelte',
  '.html', '.css', '.scss',
  '.json', '.yaml', '.yml', '.toml',
  '.md', '.mdx',
  '.sql',
  '.sh', '.bash', '.zsh', '.ps1',
]);

const MAX_FILE_SIZE_BYTES = 500 * 1024; // 500 KB

export class RepositoryIndexer {
  private logger = Logger.getInstance('RepositoryIndexer');
  private ig = ignore();
  private indexingPromise: Promise<void> | null = null;
  private pendingChanges: Set<string> = new Set();
  private changeDebounceTimer: NodeJS.Timeout | null = null;

  constructor(
    private context: vscode.ExtensionContext,
    private db: DatabaseService,
    private contextEngine: ContextEngine
  ) {}

  async indexWorkspace(): Promise<void> {
    const roots = vscode.workspace.workspaceFolders;
    if (!roots || roots.length === 0) return;

    const root = roots[0].uri.fsPath;
    this.logger.info(`Starting repository indexing: ${root}`);

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: 'Fuelix: Indexing repository...',
        cancellable: true,
      },
      async (progress, token) => {
        this.setupIgnore(root);
        const files = await this.collectFiles(root, token);
        
        progress.report({ message: `Found ${files.length} files` });

        let processed = 0;
        const batchSize = 10;

        for (let i = 0; i < files.length; i += batchSize) {
          if (token.isCancellationRequested) break;

          const batch = files.slice(i, i + batchSize);
          await Promise.all(batch.map((f) => this.indexFile(f, root)));
          
          processed += batch.length;
          const pct = Math.round((processed / files.length) * 100);
          progress.report({ message: `${pct}% — ${processed}/${files.length} files`, increment: (batch.length / files.length) * 100 });
        }

        this.logger.info(`Indexing complete: ${processed} files`);
      }
    );
  }

  private setupIgnore(root: string): void {
    const config = vscode.workspace.getConfiguration('fuelix');
    const excludePatterns = config.get<string[]>('excludePatterns', [
      '**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**',
    ]);
    this.ig = ignore();
    this.ig.add(excludePatterns);

    // Load .gitignore if present
    const gitignorePath = path.join(root, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
      this.ig.add(gitignoreContent);
    }
  }

  private async collectFiles(root: string, token: vscode.CancellationToken): Promise<string[]> {
    const files: string[] = [];

    const walk = (dir: string): void => {
      if (token.isCancellationRequested) return;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relPath = path.relative(root, fullPath);

          if (this.ig.ignores(relPath)) continue;

          if (entry.isDirectory()) {
            walk(fullPath);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (SUPPORTED_EXTENSIONS.has(ext)) {
              const stats = fs.statSync(fullPath);
              if (stats.size <= MAX_FILE_SIZE_BYTES) {
                files.push(fullPath);
              }
            }
          }
        }
      } catch (e) {
        this.logger.debug(`Skipping ${dir}: ${e}`);
      }
    };

    walk(root);
    return files;
  }

  private async indexFile(filePath: string, root: string): Promise<void> {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const ext = path.extname(filePath).toLowerCase();
      const chunks = this.chunkFile(filePath, content, ext);

      await this.db.upsertChunks(chunks);
    } catch (error) {
      this.logger.debug(`Failed to index ${filePath}`, error);
    }
  }

  private chunkFile(filePath: string, content: string, ext: string): CodeChunk[] {
    const chunks: CodeChunk[] = [];
    const lines = content.split('\n');

    if (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx') {
      chunks.push(...this.chunkByFunctions(filePath, lines, 'js'));
    } else if (ext === '.py') {
      chunks.push(...this.chunkByFunctions(filePath, lines, 'python'));
    } else {
      // Generic chunking: sliding window of 50 lines with 10-line overlap
      chunks.push(...this.chunkGeneric(filePath, lines, ext.slice(1)));
    }

    return chunks;
  }

  private chunkByFunctions(filePath: string, lines: string[], lang: string): CodeChunk[] {
    const chunks: CodeChunk[] = [];
    const functionRegexJS = /^\s*(export\s+)?(async\s+)?function\s+\w+|^\s*(export\s+)?const\s+\w+\s*=\s*(async\s+)?\(/;
    const functionRegexPy = /^(def |async def |class )/;
    const regex = lang === 'python' ? functionRegexPy : functionRegexJS;

    let currentStart = 0;
    let currentLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (regex.test(line) && currentLines.length > 0) {
        // Save current chunk
        const content = currentLines.join('\n');
        if (content.trim().length > 20) {
          chunks.push({
            filePath,
            content,
            startLine: currentStart,
            endLine: i - 1,
            chunkType: 'function',
            language: lang,
            keywords: this.extractKeywords(content),
          });
        }
        currentStart = i;
        currentLines = [line];
      } else {
        currentLines.push(line);
      }

      // Force chunk at 100 lines
      if (currentLines.length >= 100) {
        const content = currentLines.join('\n');
        chunks.push({
          filePath,
          content,
          startLine: currentStart,
          endLine: i,
          chunkType: 'block',
          language: lang,
          keywords: this.extractKeywords(content),
        });
        currentStart = i + 1;
        currentLines = [];
      }
    }

    // Push last chunk
    if (currentLines.length > 5) {
      chunks.push({
        filePath,
        content: currentLines.join('\n'),
        startLine: currentStart,
        endLine: lines.length - 1,
        chunkType: 'block',
        language: lang,
        keywords: this.extractKeywords(currentLines.join('\n')),
      });
    }

    return chunks;
  }

  private chunkGeneric(filePath: string, lines: string[], lang: string): CodeChunk[] {
    const chunks: CodeChunk[] = [];
    const chunkSize = 50;
    const overlap = 10;

    for (let i = 0; i < lines.length; i += chunkSize - overlap) {
      const chunkLines = lines.slice(i, i + chunkSize);
      const content = chunkLines.join('\n');
      if (content.trim().length > 20) {
        chunks.push({
          filePath,
          content,
          startLine: i,
          endLine: Math.min(i + chunkSize - 1, lines.length - 1),
          chunkType: 'generic',
          language: lang,
          keywords: this.extractKeywords(content),
        });
      }
    }

    return chunks;
  }

  private extractKeywords(content: string): string[] {
    // Simple keyword extraction: identifiers longer than 3 chars
    const words = content.match(/\b[a-zA-Z_][a-zA-Z0-9_]{3,}\b/g) ?? [];
    const freq = new Map<string, number>();
    for (const word of words) {
      freq.set(word, (freq.get(word) ?? 0) + 1);
    }
    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([w]) => w);
  }

  // ─── Incremental Indexing ─────────────────────────────────────────────────
  handleDocumentChange(event: vscode.TextDocumentChangeEvent): void {
    if (event.document.uri.scheme !== 'file') return;
    const filePath = event.document.uri.fsPath;
    this.pendingChanges.add(filePath);

    if (this.changeDebounceTimer) clearTimeout(this.changeDebounceTimer);
    this.changeDebounceTimer = setTimeout(() => {
      this.flushPendingChanges();
    }, 2000);
  }

  private async flushPendingChanges(): Promise<void> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    const files = [...this.pendingChanges];
    this.pendingChanges.clear();

    for (const filePath of files) {
      await this.indexFile(filePath, root);
    }

    if (files.length > 0) {
      this.logger.debug(`Re-indexed ${files.length} changed files`);
    }
  }
}
