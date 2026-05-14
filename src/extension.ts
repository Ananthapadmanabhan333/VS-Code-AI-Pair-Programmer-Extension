import * as vscode from 'vscode';
import { CompletionProvider } from './providers/CompletionProvider';
import { ChatViewProvider } from './providers/ChatViewProvider';
import { MemoryViewProvider } from './providers/MemoryViewProvider';
import { AgentViewProvider } from './providers/AgentViewProvider';
import { RepositoryIndexer } from './core/RepositoryIndexer';
import { AIOrchestrator } from './core/AIOrchestrator';
import { ContextEngine } from './core/ContextEngine';
import { MemorySystem } from './core/MemorySystem';
import { CommandRegistry } from './commands/CommandRegistry';
import { DiagnosticsEngine } from './core/DiagnosticsEngine';
import { TerminalWatcher } from './core/TerminalWatcher';
import { ObservabilityService } from './services/ObservabilityService';
import { SecretStore } from './services/SecretStore';
import { DatabaseService } from './services/DatabaseService';
import { Logger } from './utils/Logger';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const logger = Logger.getInstance('Fuelix');
  logger.info('🚀 Fuelix AI activating...');

  // ─── Core Services (order matters) ───────────────────────────────────────
  const secretStore = new SecretStore(context);
  const db = new DatabaseService(context);
  await db.initialize();

  const observability = new ObservabilityService(context, db);
  const memory = new MemorySystem(context, db);
  await memory.initialize();

  const contextEngine = new ContextEngine(context, memory, db);
  const orchestrator = new AIOrchestrator(context, secretStore, contextEngine, observability);

  const diagnosticsEngine = new DiagnosticsEngine(context, orchestrator);
  const terminalWatcher = new TerminalWatcher(context, orchestrator);

  // ─── Repository Indexer ───────────────────────────────────────────────────
  const indexer = new RepositoryIndexer(context, db, contextEngine);
  if (vscode.workspace.workspaceFolders) {
    // Run indexing in background
    indexer.indexWorkspace().catch((err) =>
      logger.error('Background indexing error', err)
    );
  }

  // ─── Providers ────────────────────────────────────────────────────────────
  const chatProvider = new ChatViewProvider(context, orchestrator, contextEngine, memory, observability);
  const memoryViewProvider = new MemoryViewProvider(context, memory, db);
  const agentViewProvider = new AgentViewProvider(context, orchestrator);
  const completionProvider = new CompletionProvider(context, orchestrator, contextEngine);

  // Register Webview Providers
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('fuelix.chatView', chatProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('fuelix.memoryView', memoryViewProvider)
  );

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('fuelix.agentsView', agentViewProvider)
  );

  // Register Inline Completion Provider
  const config = vscode.workspace.getConfiguration('fuelix');
  if (config.get<boolean>('enableInlineCompletions', true)) {
    context.subscriptions.push(
      vscode.languages.registerInlineCompletionItemProvider(
        { pattern: '**' },
        completionProvider
      )
    );
  }

  // ─── Commands ─────────────────────────────────────────────────────────────
  const commandRegistry = new CommandRegistry(
    context,
    orchestrator,
    contextEngine,
    memory,
    indexer,
    chatProvider,
    observability,
    secretStore
  );
  commandRegistry.registerAll();

  // ─── Diagnostics Subscription ─────────────────────────────────────────────
  context.subscriptions.push(
    vscode.languages.onDidChangeDiagnostics((event) => {
      diagnosticsEngine.handleDiagnosticChange(event);
    })
  );

  // ─── Document Change Listener ─────────────────────────────────────────────
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      indexer.handleDocumentChange(event);
      contextEngine.handleDocumentChange(event);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      contextEngine.handleDocumentOpen(doc);
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        contextEngine.handleEditorChange(editor);
      }
    })
  );

  // ─── Terminal Watcher ─────────────────────────────────────────────────────
  terminalWatcher.start();

  // ─── Status Bar ───────────────────────────────────────────────────────────
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    1000
  );
  statusBarItem.command = 'fuelix.openChat';
  statusBarItem.text = '$(sparkle) Fuelix AI';
  statusBarItem.tooltip = 'Open Fuelix AI Chat (Ctrl+Shift+A)';
  statusBarItem.backgroundColor = undefined;
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // ─── Welcome Message on First Install ────────────────────────────────────
  const isFirstInstall = context.globalState.get<boolean>('fuelix.firstInstall', true);
  if (isFirstInstall) {
    await context.globalState.update('fuelix.firstInstall', false);
    vscode.window
      .showInformationMessage(
        '🚀 Welcome to Fuelix AI! Configure your API key to get started.',
        'Configure API Key',
        'Open Chat'
      )
      .then((selection) => {
        if (selection === 'Configure API Key') {
          vscode.commands.executeCommand('fuelix.configureApiKey');
        } else if (selection === 'Open Chat') {
          vscode.commands.executeCommand('fuelix.openChat');
        }
      });
  }

  // ─── Configuration Change Handler ─────────────────────────────────────────
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('fuelix')) {
        orchestrator.handleConfigChange();
        if (event.affectsConfiguration('fuelix.enableInlineCompletions')) {
          vscode.window.showInformationMessage(
            'Fuelix: Reload window to apply completion settings.',
            'Reload'
          ).then((sel) => sel === 'Reload' && vscode.commands.executeCommand('workbench.action.reloadWindow'));
        }
      }
    })
  );

  logger.info('✅ Fuelix AI activated successfully');
  observability.trackEvent('extension.activated', { version: '1.0.0' });
}

export async function deactivate(): Promise<void> {
  Logger.getInstance('Fuelix').info('Fuelix AI deactivating...');
}
