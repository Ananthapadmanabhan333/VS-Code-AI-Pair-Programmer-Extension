import * as vscode from 'vscode';
import { AIOrchestrator } from './AIOrchestrator';
import { Logger } from '../utils/Logger';

export class DiagnosticsEngine {
  private logger = Logger.getInstance('DiagnosticsEngine');
  private lastDiagnostics: Map<string, vscode.Diagnostic[]> = new Map();

  constructor(
    private context: vscode.ExtensionContext,
    private orchestrator: AIOrchestrator
  ) {}

  public handleDiagnosticChange(event: vscode.DiagnosticChangeEvent): void {
    for (const uri of event.uris) {
      const diagnostics = vscode.languages.getDiagnostics(uri);
      const errors = diagnostics.filter(d => d.severity === vscode.DiagnosticSeverity.Error);
      
      if (errors.length > 0) {
        this.lastDiagnostics.set(uri.fsPath, errors);
        // We don't automatically trigger AI to avoid noise, 
        // but we keep track for the /fix or /debug commands
      } else {
        this.lastDiagnostics.delete(uri.fsPath);
      }
    }
  }

  public getErrorsForFile(fsPath: string): vscode.Diagnostic[] {
    return this.lastDiagnostics.get(fsPath) ?? [];
  }

  public async suggestFixForError(diagnostic: vscode.Diagnostic, document: vscode.TextDocument): Promise<void> {
    const code = document.getText(diagnostic.range);
    const line = diagnostic.range.start.line + 1;
    
    await vscode.commands.executeCommand('fuelix.openChat');
    // The command registry will handle the actual logic via chat provider, 
    // but this engine provides the raw data.
  }
}
