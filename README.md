# Fuelix AI — Next-Gen AI Pair Programmer for VS Code

Fuelix AI is an enterprise-grade AI coding assistant designed to rival and exceed GitHub Copilot and Cursor. It features repository-wide context awareness, multi-agent orchestration, and a premium AI-native interface.

## ✨ Key Features

- **🚀 Ultra-Low Latency Completions**: Real-time ghost text suggestions powered by optimized LLM routing.
- **🧠 Repository-Wide RAG**: Deep context awareness through semantic indexing and AST-aware chunking.
- **🛡️ Multi-Agent System**: Specialized agents for debugging, refactoring, architecture, and security.
- **💾 Persistent AI Memory**: Remembers your coding preferences, patterns, and architectural decisions.
- **💬 Advanced AI Chat**: A futuristic glassmorphic sidebar for deep reasoning and code generation.
- **💻 Terminal Intelligence**: Understands your build errors and suggests safe shell commands.
- **📈 Enterprise Observability**: Built-in tracking for latency, token usage, and AI performance.

## 🛠️ Architecture

Fuelix AI is built on a sophisticated multi-layered architecture:
1. **Frontend**: React + Tailwind CSS + Framer Motion (Webview UI).
2. **Core**: TypeScript + VS Code API + Language Server Protocol logic.
3. **Storage**: SQLite with FTS5 for fast semantic search and metadata.
4. **AI Logic**: Multi-agent orchestrator supporting OpenAI (GPT-4o) and Anthropic (Claude 3.5).

## 🚀 Getting Started

1. Install the extension from the VS Code Marketplace.
2. Open the command palette (`Ctrl+Shift+P`) and run **Fuelix: Configure API Key**.
3. Select your provider (OpenAI or Anthropic) and enter your key.
4. Open the chat sidebar (`Ctrl+Shift+A`) and start building!

## ⌨️ Keyboard Shortcuts

- `Ctrl+Shift+A`: Open Fuelix Chat
- `Ctrl+Shift+E`: Explain Selection
- `Ctrl+Shift+R`: Refactor Selection
- `Ctrl+Shift+D`: Debug Selection
- `Ctrl+Shift+T`: Generate Tests
- `Ctrl+Shift+` `: Terminal Assistant

## 📜 Slash Commands

- `/explain`: Get deep code explanations.
- `/refactor`: Architecture-aware code improvement.
- `/debug`: Identify and fix complex bugs.
- `/test`: Generate comprehensive test suites.
- `/terminal`: Command generation and error analysis.
- `/architecture`: High-level structural reviews.
- `/security`: Professional security vulnerability scans.

## 🔒 Security & Privacy

- All API keys are stored securely in VS Code's **SecretStorage**.
- No code is sent to external servers except for the AI requests you explicitly trigger.
- Indexing is performed locally in a background SQLite database.

## 🛠️ Development

```bash
# Install dependencies
npm install
cd webview-ui && npm install

# Run in development mode
npm run watch
```

Press `F5` in VS Code to launch the extension development host.

---
Built with ❤️ by the Fuelix AI Team.
