import * as vscode from 'vscode';
import { AIOrchestrator } from '../core/AIOrchestrator';
import { ContextEngine } from '../core/ContextEngine';
import { MemorySystem } from '../core/MemorySystem';
import { ObservabilityService } from '../services/ObservabilityService';
import { ChatMessage } from '../types';
import { getNonce } from '../utils/getNonce';
import { Logger } from '../utils/Logger';
import * as path from 'path';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'fuelix.chatView';
  private logger = Logger.getInstance('ChatViewProvider');
  private view?: vscode.WebviewView;
  private conversationId: string;
  private messages: ChatMessage[] = [];
  private cancelTokenSource?: vscode.CancellationTokenSource;

  constructor(
    private context: vscode.ExtensionContext,
    private orchestrator: AIOrchestrator,
    private contextEngine: ContextEngine,
    private memory: MemorySystem,
    private observability: ObservabilityService
  ) {
    this.conversationId = this.generateConversationId();
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _webviewContext: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        this.context.extensionUri,
        vscode.Uri.joinPath(this.context.extensionUri, 'webview-ui', 'dist'),
      ],
    };

    webviewView.webview.html = this.getWebviewContent(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(
      async (message) => await this.handleMessage(message),
      undefined,
      this.context.subscriptions
    );
  }

  private async handleMessage(message: any): Promise<void> {
    switch (message.type) {
      case 'sendMessage':
        await this.handleUserMessage(message.content, message.slashCommand);
        break;
      case 'cancelGeneration':
        this.cancelTokenSource?.cancel();
        break;
      case 'clearConversation':
        this.clearConversation();
        break;
      case 'newConversation':
        this.startNewConversation();
        break;
      case 'copyCode':
        vscode.env.clipboard.writeText(message.code);
        break;
      case 'insertCode':
        this.insertCodeInEditor(message.code);
        break;
      case 'openFile':
        this.openFileInEditor(message.filePath, message.line);
        break;
      case 'applyDiff':
        await this.applyDiff(message.original, message.modified, message.fileName);
        break;
      case 'getContext':
        await this.sendContextToWebview();
        break;
      case 'loadConversation':
        this.loadConversation(message.conversationId);
        break;
      case 'trackFeedback':
        this.observability.trackEvent('chat.feedback', {
          positive: message.positive,
          messageId: message.messageId,
        });
        break;
    }
  }

  async handleUserMessage(content: string, slashCommand?: string): Promise<void> {
    this.cancelTokenSource = new vscode.CancellationTokenSource();

    const processedContent = slashCommand
      ? `${slashCommand} ${content}`.trim()
      : content;

    this.messages.push({ role: 'user', content: processedContent });
    this.postMessage({ type: 'userMessage', content: processedContent });

    // Build context
    const contextBlock = await this.contextEngine.buildChatContext(processedContent);
    const systemPrompt = this.buildSystemPrompt(contextBlock, slashCommand);

    // Determine agent type from slash command
    const agentType = this.getAgentTypeFromCommand(slashCommand);

    this.postMessage({ type: 'startStream', agentType });

    let fullResponse = '';
    try {
      fullResponse = await this.orchestrator.chat(
        this.messages,
        systemPrompt,
        (delta) => {
          this.postMessage({ type: 'streamDelta', delta });
        },
        this.cancelTokenSource.token
      );

      this.messages.push({ role: 'assistant', content: fullResponse });
      this.postMessage({ type: 'streamEnd', fullResponse });

      // Extract and save memories in background
      this.memory
        .extractAndSaveFromConversation(processedContent, fullResponse)
        .catch((e) => this.logger.error('Memory extraction failed', e));

      this.observability.trackEvent('chat.message', { agentType, hasSlashCommand: !!slashCommand });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'An unknown error occurred';
      this.postMessage({ type: 'streamError', error: errMsg });
      this.logger.error('Chat stream failed', error);
    }
  }

  // Public method for commands to send to chat
  async sendToChat(content: string, slashCommand?: string): Promise<void> {
    if (this.view) {
      this.view.show(true);
    }
    await this.handleUserMessage(content, slashCommand);
  }

  private buildSystemPrompt(contextBlock: string, slashCommand?: string): string {
    const basePrompt = `You are Fuelix AI, an elite AI pair programmer and software engineering assistant.

## Your Capabilities
- Deep code analysis and explanation
- Architecture design and review  
- Bug detection and fixing
- Refactoring and optimization
- Test generation
- Security analysis
- Documentation generation
- Terminal command assistance

## Response Guidelines
- Use markdown formatting with proper code blocks
- Specify language in code blocks (e.g., \`\`\`typescript)
- Be precise and technically accurate
- When showing code changes, use before/after diffs
- Reference specific line numbers when relevant
- Proactively suggest improvements

## Current Repository Context
${contextBlock}

## Slash Command Mode
${slashCommand ? `You are operating in "${slashCommand}" mode. Focus specifically on that task.` : 'General assistance mode.'}`;

    return basePrompt;
  }

  private getAgentTypeFromCommand(command?: string): string {
    const map: Record<string, string> = {
      '/explain': 'explanation',
      '/refactor': 'refactoring',
      '/debug': 'debugging',
      '/test': 'testing',
      '/docs': 'documentation',
      '/optimize': 'optimization',
      '/terminal': 'terminal',
      '/architecture': 'architecture',
      '/security': 'security',
      '/fix': 'debugging',
      '/review': 'review',
    };
    return command ? (map[command] ?? 'chat') : 'chat';
  }

  private clearConversation(): void {
    this.messages = [];
    this.postMessage({ type: 'conversationCleared' });
  }

  private startNewConversation(): void {
    this.messages = [];
    this.conversationId = this.generateConversationId();
    this.postMessage({ type: 'newConversation', conversationId: this.conversationId });
  }

  private async sendContextToWebview(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    this.postMessage({
      type: 'contextUpdate',
      fileName: editor ? path.basename(editor.document.uri.fsPath) : null,
      language: editor?.document.languageId ?? null,
      hasSelection: editor ? !editor.selection.isEmpty : false,
      openFiles: this.contextEngine.getOpenTabFiles().map((f) => path.basename(f)),
    });
  }

  private insertCodeInEditor(code: string): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('No active editor to insert code into.');
      return;
    }
    editor.edit((editBuilder) => {
      if (editor.selection.isEmpty) {
        editBuilder.insert(editor.selection.active, code);
      } else {
        editBuilder.replace(editor.selection, code);
      }
    });
  }

  private openFileInEditor(filePath: string, line?: number): void {
    const uri = vscode.Uri.file(filePath);
    vscode.window.showTextDocument(uri).then((editor) => {
      if (line !== undefined) {
        const position = new vscode.Position(line - 1, 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position));
      }
    });
  }

  private async applyDiff(original: string, modified: string, fileName: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const action = await vscode.window.showQuickPick(
      ['Apply Changes', 'Preview in Diff View', 'Cancel'],
      { placeHolder: `Apply AI-suggested changes to ${fileName}?` }
    );

    if (action === 'Apply Changes') {
      const fullText = editor.document.getText();
      const newText = fullText.replace(original, modified);
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        editor.document.uri,
        new vscode.Range(0, 0, editor.document.lineCount, 0),
        newText
      );
      vscode.workspace.applyEdit(edit);
    } else if (action === 'Preview in Diff View') {
      // Open diff
      vscode.commands.executeCommand('vscode.diff',
        this.createVirtualDocument(original, 'original'),
        this.createVirtualDocument(modified, 'modified'),
        `Fuelix: ${fileName} (AI Changes)`
      );
    }
  }

  private createVirtualDocument(content: string, label: string): vscode.Uri {
    return vscode.Uri.parse(`untitled:fuelix-${label}-${Date.now()}`);
  }

  private loadConversation(conversationId: string): void {
    // Would load from DB in a full implementation
    this.logger.info(`Loading conversation: ${conversationId}`);
  }

  private postMessage(message: any): void {
    this.view?.webview.postMessage(message);
  }

  private generateConversationId(): string {
    return `conv-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  private getWebviewContent(webview: vscode.Webview): string {
    const nonce = getNonce();
    const extensionUri = this.context.extensionUri;

    // Try to use built webview
    const distPath = vscode.Uri.joinPath(extensionUri, 'webview-ui', 'dist');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(distPath, 'assets', 'index.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(distPath, 'assets', 'index.css'));

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data: https:; font-src ${webview.cspSource} https:;" />
  <title>Fuelix AI</title>
  <link rel="stylesheet" href="${styleUri}" />
  <style>
    :root {
      --vscode-font-family: var(--vscode-editor-font-family, 'Inter', system-ui, sans-serif);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body, #root { height: 100%; width: 100%; overflow: hidden; }
    body { background: transparent; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
