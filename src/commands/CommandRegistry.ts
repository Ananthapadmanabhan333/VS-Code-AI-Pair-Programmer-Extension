import * as vscode from 'vscode';
import { AIOrchestrator } from '../core/AIOrchestrator';
import { ContextEngine } from '../core/ContextEngine';
import { MemorySystem } from '../core/MemorySystem';
import { RepositoryIndexer } from '../core/RepositoryIndexer';
import { ChatViewProvider } from '../providers/ChatViewProvider';
import { ObservabilityService } from '../services/ObservabilityService';
import { SecretStore } from '../services/SecretStore';
import { Logger } from '../utils/Logger';
import * as path from 'path';

export class CommandRegistry {
  private logger = Logger.getInstance('CommandRegistry');

  constructor(
    private context: vscode.ExtensionContext,
    private orchestrator: AIOrchestrator,
    private contextEngine: ContextEngine,
    private memory: MemorySystem,
    private indexer: RepositoryIndexer,
    private chatProvider: ChatViewProvider,
    private observability: ObservabilityService,
    private secretStore: SecretStore
  ) {}

  registerAll(): void {
    const commands = [
      ['fuelix.openChat', () => this.openChat()],
      ['fuelix.explainCode', () => this.explainCode()],
      ['fuelix.refactorCode', () => this.refactorCode()],
      ['fuelix.debugCode', () => this.debugCode()],
      ['fuelix.generateTests', () => this.generateTests()],
      ['fuelix.terminalAssistant', () => this.terminalAssistant()],
      ['fuelix.architectureAnalysis', () => this.architectureAnalysis()],
      ['fuelix.generateDocs', () => this.generateDocs()],
      ['fuelix.securityReview', () => this.securityReview()],
      ['fuelix.optimizeCode', () => this.optimizeCode()],
      ['fuelix.indexRepository', () => this.indexRepository()],
      ['fuelix.clearMemory', () => this.clearMemory()],
      ['fuelix.showMemoryPanel', () => this.showMemoryPanel()],
      ['fuelix.configureApiKey', () => this.configureApiKey()],
      ['fuelix.showDashboard', () => this.showDashboard()],
    ] as const;

    for (const [cmd, handler] of commands) {
      this.context.subscriptions.push(
        vscode.commands.registerCommand(cmd, handler)
      );
    }

    this.logger.info(`Registered ${commands.length} commands`);
  }

  private async openChat(): Promise<void> {
    await vscode.commands.executeCommand('workbench.view.extension.fuelix-sidebar');
    await vscode.commands.executeCommand('fuelix.chatView.focus');
    this.observability.trackEvent('command.openChat');
  }

  private async explainCode(): Promise<void> {
    const code = this.getSelectedOrFullCode();
    if (!code) return;

    await this.openChat();
    await this.chatProvider.sendToChat(
      `Please explain the following code in detail:\n\n\`\`\`${this.getLanguageId()}\n${code}\n\`\`\``,
      '/explain'
    );
    this.observability.trackEvent('command.explainCode');
  }

  private async refactorCode(): Promise<void> {
    const code = this.getSelectedOrFullCode();
    if (!code) return;

    const options = [
      'Improve readability and maintainability',
      'Extract into smaller functions',
      'Apply SOLID principles',
      'Optimize for performance',
      'Add proper error handling',
      'Modernize syntax and patterns',
      'Remove code duplication',
    ];

    const selected = await vscode.window.showQuickPick(options, {
      placeHolder: 'How would you like to refactor this code?',
    });

    if (!selected) return;

    await this.openChat();
    await this.chatProvider.sendToChat(
      `Refactor the following code with this goal: "${selected}"\n\nProvide the complete refactored code with explanations.\n\n\`\`\`${this.getLanguageId()}\n${code}\n\`\`\``,
      '/refactor'
    );
    this.observability.trackEvent('command.refactorCode');
  }

  private async debugCode(): Promise<void> {
    const code = this.getSelectedOrFullCode();
    if (!code) return;

    // Try to get diagnostic errors for current file
    const editor = vscode.window.activeTextEditor;
    const diagnostics = editor
      ? vscode.languages.getDiagnostics(editor.document.uri)
          .filter((d) => d.severity === vscode.DiagnosticSeverity.Error)
          .map((d) => `Line ${d.range.start.line + 1}: ${d.message}`)
          .join('\n')
      : '';

    const errorContext = diagnostics
      ? `\n\n## Current Errors:\n${diagnostics}`
      : '';

    await this.openChat();
    await this.chatProvider.sendToChat(
      `Debug the following code. Identify all bugs, explain root causes, and provide fixed code with explanations.${errorContext}\n\n\`\`\`${this.getLanguageId()}\n${code}\n\`\`\``,
      '/debug'
    );
    this.observability.trackEvent('command.debugCode');
  }

  private async generateTests(): Promise<void> {
    const code = this.getSelectedOrFullCode();
    if (!code) return;

    const frameworks: Record<string, string[]> = {
      typescript: ['Jest', 'Vitest', 'Mocha + Chai'],
      javascript: ['Jest', 'Vitest', 'Mocha + Chai'],
      python: ['pytest', 'unittest', 'pytest + fixtures'],
      go: ['testing (stdlib)', 'testify'],
      rust: ['Built-in (#[test])', 'tokio::test (async)'],
      java: ['JUnit 5', 'TestNG'],
    };

    const lang = this.getLanguageId();
    const availableFrameworks = frameworks[lang] ?? ['Default'];

    const framework = await vscode.window.showQuickPick(availableFrameworks, {
      placeHolder: `Select testing framework for ${lang}`,
    });

    if (!framework) return;

    await this.openChat();
    await this.chatProvider.sendToChat(
      `Generate comprehensive unit tests for the following ${lang} code using ${framework}. Include edge cases, error scenarios, and happy path tests.\n\n\`\`\`${lang}\n${code}\n\`\`\``,
      '/test'
    );
    this.observability.trackEvent('command.generateTests');
  }

  private async terminalAssistant(): Promise<void> {
    const input = await vscode.window.showInputBox({
      placeHolder: 'What terminal command do you need? (e.g., "deploy to production", "set up Docker")',
      prompt: 'Fuelix Terminal Assistant',
    });

    if (!input) return;

    const terminal = vscode.window.activeTerminal;
    const shellName = (terminal as any)?.creationOptions?.shellPath ?? 'bash';

    await this.openChat();
    await this.chatProvider.sendToChat(
      `Generate the terminal commands for: "${input}"\n\nShell: ${shellName}\nOS: ${process.platform}\n\nProvide safe, tested commands with explanations. Warn about any destructive operations.`,
      '/terminal'
    );
    this.observability.trackEvent('command.terminalAssistant');
  }

  private async architectureAnalysis(): Promise<void> {
    const structure = await this.contextEngine.getProjectStructure();

    await this.openChat();
    await this.chatProvider.sendToChat(
      `Analyze the architecture of this project and provide:\n1. Current architecture assessment\n2. Identified patterns and anti-patterns\n3. Improvement recommendations\n4. Scalability considerations\n\n## Project Structure:\n${structure}`,
      '/architecture'
    );
    this.observability.trackEvent('command.architectureAnalysis');
  }

  private async generateDocs(): Promise<void> {
    const code = this.getSelectedOrFullCode();
    if (!code) return;

    await this.openChat();
    await this.chatProvider.sendToChat(
      `Generate comprehensive documentation for the following code. Include:\n- Function/class descriptions\n- Parameter descriptions\n- Return value descriptions\n- Usage examples\n- Any important notes or warnings\n\n\`\`\`${this.getLanguageId()}\n${code}\n\`\`\``,
      '/docs'
    );
    this.observability.trackEvent('command.generateDocs');
  }

  private async securityReview(): Promise<void> {
    const code = this.getSelectedOrFullCode();
    if (!code) return;

    await this.openChat();
    await this.chatProvider.sendToChat(
      `Perform a thorough security review of the following code. Check for:\n- OWASP Top 10 vulnerabilities\n- SQL injection, XSS, CSRF\n- Insecure data handling\n- Authentication/authorization issues\n- Dependency vulnerabilities\n- Secrets in code\n\nProvide CVSS scores and remediation code.\n\n\`\`\`${this.getLanguageId()}\n${code}\n\`\`\``,
      '/security'
    );
    this.observability.trackEvent('command.securityReview');
  }

  private async optimizeCode(): Promise<void> {
    const code = this.getSelectedOrFullCode();
    if (!code) return;

    await this.openChat();
    await this.chatProvider.sendToChat(
      `Optimize the following code for performance. Analyze:\n- Time complexity (Big O)\n- Space complexity\n- Memory allocations\n- I/O bottlenecks\n- Algorithmic improvements\n\nProvide the optimized version with benchmarks where possible.\n\n\`\`\`${this.getLanguageId()}\n${code}\n\`\`\``,
      '/optimize'
    );
    this.observability.trackEvent('command.optimizeCode');
  }

  private async indexRepository(): Promise<void> {
    this.observability.trackEvent('command.indexRepository');
    await this.indexer.indexWorkspace();
    vscode.window.showInformationMessage('✅ Fuelix: Repository indexed successfully!');
  }

  private async clearMemory(): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
      'Clear all Fuelix AI memory? This cannot be undone.',
      { modal: true },
      'Clear Memory'
    );
    if (confirm === 'Clear Memory') {
      await this.memory.clearAll();
      vscode.window.showInformationMessage('🧹 Fuelix: AI memory cleared.');
      this.observability.trackEvent('command.clearMemory');
    }
  }

  private async showMemoryPanel(): Promise<void> {
    await vscode.commands.executeCommand('fuelix.memoryView.focus');
  }

  private async configureApiKey(): Promise<void> {
    const provider = await vscode.window.showQuickPick(
      ['OpenAI (GPT-4o, GPT-4)', 'Anthropic (Claude 3.5 Sonnet, Haiku)'],
      { placeHolder: 'Select AI provider to configure' }
    );

    if (!provider) return;

    const isOpenAI = provider.startsWith('OpenAI');
    const apiKey = await vscode.window.showInputBox({
      placeHolder: isOpenAI ? 'sk-...' : 'sk-ant-...',
      prompt: `Enter your ${isOpenAI ? 'OpenAI' : 'Anthropic'} API Key (stored securely)`,
      password: true,
      validateInput: (val) => {
        if (!val) return 'API key cannot be empty';
        if (isOpenAI && !val.startsWith('sk-')) return 'OpenAI keys start with sk-';
        return null;
      },
    });

    if (!apiKey) return;

    if (isOpenAI) {
      await this.secretStore.storeOpenAIKey(apiKey);
    } else {
      await this.secretStore.storeAnthropicKey(apiKey);
    }

    this.orchestrator.handleConfigChange();
    vscode.window.showInformationMessage(`✅ ${isOpenAI ? 'OpenAI' : 'Anthropic'} API key saved securely!`);
    this.observability.trackEvent('command.configureApiKey', { provider: isOpenAI ? 'openai' : 'anthropic' });
  }

  private async showDashboard(): Promise<void> {
    const stats = this.observability.getStats();
    const panel = vscode.window.createWebviewPanel(
      'fuzelixDashboard',
      'Fuelix Analytics Dashboard',
      vscode.ViewColumn.Beside,
      { enableScripts: true }
    );
    panel.webview.html = this.getDashboardHtml(stats);
  }

  private getDashboardHtml(stats: any): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Fuelix Dashboard</title>
  <style>
    body { font-family: system-ui; background: #0d1117; color: #e6edf3; padding: 24px; margin: 0; }
    .header { display: flex; align-items: center; gap: 12px; margin-bottom: 32px; }
    .header h1 { font-size: 24px; font-weight: 700; background: linear-gradient(135deg, #6366f1, #8b5cf6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 32px; }
    .card { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 20px; }
    .card .label { font-size: 13px; color: #8b949e; margin-bottom: 8px; }
    .card .value { font-size: 28px; font-weight: 700; color: #6366f1; }
    .card .sub { font-size: 12px; color: #8b949e; margin-top: 4px; }
  </style>
</head>
<body>
  <div class="header"><h1>⚡ Fuelix Analytics</h1></div>
  <div class="grid">
    <div class="card">
      <div class="label">Total Completions</div>
      <div class="value">${stats.totalCompletions}</div>
      <div class="sub">This week</div>
    </div>
    <div class="card">
      <div class="label">Avg Latency</div>
      <div class="value">${stats.avgLatency}ms</div>
      <div class="sub">Completion speed</div>
    </div>
    <div class="card">
      <div class="label">Memory Entries</div>
      <div class="value">${stats.memoryCount}</div>
      <div class="sub">Stored context items</div>
    </div>
    <div class="card">
      <div class="label">Chat Sessions</div>
      <div class="value">${stats.chatSessions}</div>
      <div class="sub">All time</div>
    </div>
  </div>
</body>
</html>`;
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────
  private getSelectedOrFullCode(): string | null {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('No active editor.');
      return null;
    }
    if (!editor.selection.isEmpty) {
      return editor.document.getText(editor.selection);
    }
    return editor.document.getText();
  }

  private getLanguageId(): string {
    return vscode.window.activeTextEditor?.document.languageId ?? 'text';
  }
}
