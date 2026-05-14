import * as vscode from 'vscode';
import { MemorySystem, MemoryEntry } from '../core/MemorySystem';
import { DatabaseService } from '../services/DatabaseService';

export class MemoryViewProvider implements vscode.TreeDataProvider<MemoryItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<MemoryItem | undefined | void> = new vscode.EventEmitter<MemoryItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<MemoryItem | undefined | void> = this._onDidChangeTreeData.event;

  constructor(
    private context: vscode.ExtensionContext,
    private memory: MemorySystem,
    private db: DatabaseService
  ) {
    // Refresh when memory changes (simple interval for now)
    setInterval(() => this.refresh(), 10000);
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: MemoryItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: MemoryItem): Promise<MemoryItem[]> {
    if (element) return [];

    const memories = await this.memory.getAllMemories();
    return memories.map(m => new MemoryItem(
      m.summary,
      m.type,
      m.id,
      vscode.TreeItemCollapsibleState.None
    ));
  }
}

class MemoryItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly type: string,
    public readonly memoryId: number,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);
    this.tooltip = `${this.type}: ${this.label}`;
    this.description = this.type;
    this.contextValue = 'memoryItem';
    
    // Icons based on type
    const iconMap: Record<string, string> = {
      'preference': 'settings-gear',
      'pattern': 'symbol-structure',
      'conversation': 'comment-discussion',
      'error': 'error',
      'architecture': 'circuit-board'
    };
    this.iconPath = new vscode.ThemeIcon(iconMap[type] || 'history');
  }
}
