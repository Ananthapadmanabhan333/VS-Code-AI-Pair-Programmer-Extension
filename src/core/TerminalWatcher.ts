import * as vscode from 'vscode';
import { AIOrchestrator } from './AIOrchestrator';
import { Logger } from '../utils/Logger';

export class TerminalWatcher {
  private logger = Logger.getInstance('TerminalWatcher');
  private terminalOutput: Map<number, string[]> = new Map();

  constructor(
    private context: vscode.ExtensionContext,
    private orchestrator: AIOrchestrator
  ) {}

  public start(): void {
    this.context.subscriptions.push(
      vscode.window.onDidOpenTerminal((terminal) => {
        this.logger.info(`Terminal opened: ${terminal.name}`);
      })
    );
  }

  public getRecentOutput(terminal?: vscode.Terminal): string {
    const id = (terminal as any)?._id || 0;
    return (this.terminalOutput.get(id) || []).join('');
  }

  public async analyzeTerminalError(): Promise<void> {
    const activeTerminal = vscode.window.activeTerminal;
    if (!activeTerminal) return;

    const output = this.getRecentOutput(activeTerminal);
    if (!output.trim()) {
      vscode.window.showInformationMessage('No recent terminal output to analyze.');
      return;
    }

    await vscode.commands.executeCommand('fuelix.openChat');
    // Logic will be triggered via /terminal or /fix in chat
  }
}
