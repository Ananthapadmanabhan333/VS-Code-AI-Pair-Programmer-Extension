import * as vscode from 'vscode';
import { AIOrchestrator } from '../core/AIOrchestrator';

export class AgentViewProvider implements vscode.TreeDataProvider<AgentItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<AgentItem | undefined | void> = new vscode.EventEmitter<AgentItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<AgentItem | undefined | void> = this._onDidChangeTreeData.event;

  constructor(
    private context: vscode.ExtensionContext,
    private orchestrator: AIOrchestrator
  ) {
    setInterval(() => this.refresh(), 2000);
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: AgentItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: AgentItem): Promise<AgentItem[]> {
    if (element) return [];

    const agents = this.orchestrator.getActiveAgents();
    return agents.map(a => new AgentItem(
      a.type.toUpperCase(),
      a.status,
      a.id,
      vscode.TreeItemCollapsibleState.None
    ));
  }
}

class AgentItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly status: string,
    public readonly agentId: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);
    this.tooltip = `Agent ID: ${this.agentId}`;
    this.description = status;
    
    if (status === 'running') {
      this.iconPath = new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.blue'));
    } else if (status === 'failed') {
      this.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
    } else {
      this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
    }
  }
}
