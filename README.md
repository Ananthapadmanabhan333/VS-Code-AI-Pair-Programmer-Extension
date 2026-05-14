# 🚀 Fuelix AI — Next-Generation AI Pair Programmer

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/Ananthapadmanabhan333/VS-Code-AI-Pair-Programmer-Extension)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Visual Studio Code](https://img.shields.io/badge/Visual%20Studio%20Code-007ACC?logo=visual-studio-code&logoColor=white)](https://code.visualstudio.com/)

**Fuelix AI** is a professional-grade AI coding assistant built for the modern developer. Designed to rival industry leaders like GitHub Copilot and Cursor, Fuelix provides repository-wide intelligence, multi-agent orchestration, and a sleek, futuristic interface directly within VS Code.

---

## ✨ Features that Empower You

- **⚡ Ultra-Low Latency completions**: Blazing fast ghost-text suggestions powered by optimized LLM routing and context pruning.
- **🔍 Deep Repository Indexing**: AST-aware semantic search using SQLite FTS5 for precise, project-wide context.
- **🤖 Multi-Agent Orchestration**: Specialized AI agents for Debugging, Refactoring, Documentation, and Security Review.
- **🧠 Persistent AI Memory**: remembers your architectural decisions, coding style, and project preferences across sessions.
- **🎨 Premium AI Dashboard**: A futuristic glassmorphic chat interface with smooth animations and deep markdown support.
- **🛡️ Security First**: All API keys are stored in VS Code's encrypted SecretStorage. Local-first indexing ensures your code stays private.

---

## 🛠️ Built with cutting-edge Tech

- **Frontend**: React + Tailwind CSS + Framer Motion
- **Core Engine**: TypeScript + VS Code Extension API
- **Intelligence**: OpenAI (GPT-4o) & Anthropic (Claude 3.5 Sonnet)
- **Local Data**: SQLite with Full-Text Search (FTS5)
- **Observability**: Built-in latency and token usage tracking

---

## 🚀 Getting Started

### 1. Installation
Clone this repository and open it in VS Code:
```bash
git clone https://github.com/Ananthapadmanabhan333/VS-Code-AI-Pair-Programmer-Extension.git
cd VS-Code-AI-Pair-Programmer-Extension
npm install
cd webview-ui && npm install
```

### 2. Configuration
- Press `F5` to start the Extension Development Host.
- Open the Command Palette (`Ctrl+Shift+P`) and run **Fuelix: Configure API Key**.
- Enter your OpenAI or Anthropic API key.

### 3. Usage
- `Ctrl+Shift+A`: Open the AI Chat Sidebar.
- `Ctrl+Shift+E`: Explain the selected code.
- `Ctrl+Shift+D`: Debug and fix errors automatically.
- `/explain`, `/refactor`, `/test`, `/security`: Use slash commands in chat for specialized tasks.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Ctrl+Shift+A` | Open Fuelix Chat |
| `Ctrl+Shift+E` | Explain Code |
| `Ctrl+Shift+R` | Refactor Code |
| `Ctrl+Shift+D` | Debug & Fix |
| `Ctrl+Shift+T` | Generate Tests |
| `Ctrl+Shift+` ` | Terminal Assistant |

---

## 🤝 Contributing

Contributions are welcome! If you have ideas for new features or agents, please open an issue or submit a pull request.

---

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

Built with ❤️ by the Fuelix AI Team.
