# Mocu — More capability. Still you.

**Languages:** [English](README.md) · [فارسی](README.fa.md)

<p align="center">
  <img src="public/mocugit.png" alt="Mocu — a personal AI workspace built to amplify your capabilities" width="100%" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Status-Alpha-orange?style=for-the-badge" alt="Status: Alpha" />
  <img src="https://img.shields.io/badge/Download-Windows-0078D4?style=for-the-badge" alt="Installer available for Windows" />
  <img src="https://img.shields.io/badge/License-Apache%202.0-green?style=for-the-badge" alt="License: Apache 2.0" />
</p>

> **Mocu wasn't built to replace you. It was built to amplify what you can do.**

Your ideas, judgment, and goals stay at the center. Mocu brings personal AI agents, tools, knowledge, and memory together so you can move your work forward with greater productivity—not hand over your role in it.

Build an AI team around the way **you** work. Teach it your methods. Give it the tools and up-to-date knowledge it needs. Then work with it in one desktop workspace, from a quick task to a long-running project.

**[Download for Windows](https://github.com/kharchangai/Mocu/releases) · [Build from source](#build-from-source) · [Report a bug](https://github.com/kharchangai/Mocu/issues)**

> **Alpha release:** Mocu is under active development. Bugs, unfinished features, and breaking changes are possible. Back up important work and review AI-generated output and actions before relying on them.

---

## Your own AI team—without learning to program

A generic assistant doesn't know how you want every job done. With Mocu, you can create **personal specialist agents** for your work simply by describing what you need in natural language.

> “Create a research agent that uses my reference documents, a writing agent that follows my style, and a reviewer that checks the result. Let the writing agent delegate research and review to the other two.”

Each agent can have its own instructions, tools, skills, extensions, model, and sub-agents. Start with one useful specialist, then connect agents into more sophisticated systems as your needs grow—without writing their definitions by hand.

- **Make them yours:** define their role, working style, and the tools they may use.
- **Build reusable systems:** combine specialists and let an agent delegate to other agents.
- **Use them when you need them:** select a saved agent with `/agent` or ask Mocu to delegate a task in plain language.
- **Refine them over time:** ask Mocu to update an agent as your workflow changes.

These are your reusable assistants, built around your responsibilities—not a one-size-fits-all AI persona. Agents run when invoked; scheduled runs let you automate specific work at times you choose.

## Extend Mocu around your needs

Your workflow shouldn't stop where an app's built-in features end. **Extensions add new tools and integrations**, so Mocu can grow with the work you want to do.

Install bundled extensions from the Extensions page, or add an extension from a folder or ZIP. Select the extensions you want to use with `/extension`, and their tools become available for that request. Installation alone does not activate them in chat.

**You don't have to write the code yourself.** Describe the capability you want and ask Mocu to help build a custom extension, including its code and packaging. This is an AI-assisted development workflow: generated extensions still need testing, and integrations may require API keys, permissions, or external services. It is not a guarantee that every integration will work in one click.

Under the hood, extensions run as Node.js or Python programs. Developers can also build them directly using the included SDKs, and MCP support offers another way to connect external tools.

### Agents + skills + extensions = your own intelligent workflow

| Building block | What it contributes |
|---|---|
| **Agents** | Who does the work: specialists with roles, tools, and delegation. |
| **Skills** | How the work should be done: reusable instructions and methods. |
| **Extensions** | What the system can do: new tools and integrations. |

Together, they let you build complex AI workflows without needing to be a programmer yourself. The complexity can live in the system you build—not in the instructions you repeat every day.

For example, a content workflow could combine a research agent, a writer, and a reviewer; a skill for your editorial process; and an extension for your publishing tools. Your documents provide the current product facts, while your notes keep personal priorities in view.

## Give your agents current knowledge—not just model training

Models don't automatically know your latest product changes, internal processes, or project conventions. **Mocu Docs** lets you supply that knowledge and keep it up to date.

Save reference material, procedures, product information, or guidance as searchable knowledge documents. Mocu finds relevant document references for the current request, then reads the full documents when it needs their details.

- **Keep knowledge current:** update documents as your work changes.
- **Give agents context:** provide the rules, facts, and methods they need to understand the task.
- **Avoid pasting the same background repeatedly:** make useful knowledge available across conversations.
- **Start without a separate RAG stack:** use Mocu's built-in knowledge workflow instead of assembling an external retrieval system yourself.

This is still a retrieval-based system: it combines keyword and semantic search, with optional Jev reranking, and reads document bodies on demand. It doesn't retrain the model or automatically refresh information you haven't updated.

## Notes that bring your intentions back into the conversation

Not everything needs a full document. **Notes** are for the important things you want to keep close: preferences, decisions, plans, and things you don't want to forget.

> “Remember this: before publishing a release announcement, I want to update the screenshots and check the download link.”

Notes are saved **exactly as you write them**. When a conversation touches a related topic, Mocu can retrieve and use relevant notes to account for what you wanted to do—or remind you of it while helping with the task.

Use **Docs** for structured reference knowledge. Use **Notes** for your personal context and intentions. For a reminder at a specific time, use **Schedule**.

## Plan your day—and schedule your agents

Mocu's scheduling system supports both everyday reminders and **automatic runs of your saved agents**.

- Set a reminder for a meeting, deadline, or task.
- Schedule a specialist agent to run with an instruction at a chosen date and time.
- Repeat reminders or agent runs daily, weekly, or monthly.
- Manage schedules and inspect past triggers from the Schedule page.

Want a morning briefing? Create an agent for it, then schedule it with the input and exact time you choose. Want help remembering a commitment? Set a reminder instead.

**Mocu must be open for schedules to run at their scheduled time.** On startup it catches up recently missed items; recurring schedules advance to their next future occurrence rather than replaying every missed run.

## Built for work that lasts longer than one conversation

Long projects shouldn't mean starting from zero every time you return. **Mocu Projects** connect a workspace to a folder on your computer and give it its own chat history and project memory.

Mocu saves project conversations and retrieves relevant past work when you continue. Global personal memory adds context about you across sessions, while project-scoped memory keeps ongoing work tied to the right workspace.

Completed Focus sections and Step-by-Step steps leave **compact memory handoffs**. Later work can use those summaries—and retrieve specific details when needed—instead of carrying the entire transcript into every model call.

The goal is continuity across long-running, multi-session projects, with less repeated explanation and more manageable context. Memory helps preserve progress; it does not promise perfect recall or remove model context limits.

## Focus or go step by step—in the same project chat

Big tasks don't always need the same working style. Mocu gives you two ways to work through them without juggling separate chats.

### Focus: stay with one goal

Start with `/focus <goal>` in a project chat. Work in flexible sections that you control, adding sections as the work develops. Say **“next section”** to move on or **“end Focus”** to finish.

Choose Focus when you know the goal but want room to explore and decide the next section along the way.

### Step-by-Step: turn a task into a manageable plan

Start with `/step <task>` in a project chat. Mocu proposes a plan of small steps. Review it, then work through the steps one at a time, with visible progress and saved handoffs.

Choose Step-by-Step when you want a clear plan before you begin and a structured path through the work.

**Both modes work only in project chats.** Each completed section or step is saved to project memory so the next part can build on what you've already done.

---

## Get started

### Download the Windows alpha

**[Get the Windows installer from GitHub Releases →](https://github.com/kharchangai/Mocu/releases)**

Prebuilt installers are currently available **only for Windows**. A **macOS installer is coming soon**. In the meantime, you can clone the repository and build Mocu yourself on macOS or Linux using the instructions below. Platform-specific build or runtime issues may still occur in this alpha.

### Set up your workspace

1. Open **Settings** and configure an OpenAI-compatible AI provider: API key, base URL, and model names. Mocu is model-agnostic; you choose the provider and models.
2. Describe your first personal agent and ask Mocu to create it.
3. Add a useful knowledge document and a note about how you want to work.
4. Install and select any extensions you need. Node.js is required for Node extensions; Python is required for Python extensions.
5. Open a **Project** for ongoing work, then try `/focus` or `/step`.

An API key is required for AI features, and provider usage may incur charges. Web search additionally requires a Perplexity API key configured in Settings.

## Build from source

Mocu uses **Tauri 2 + Rust** for its desktop backend and **React + TypeScript + Vite** for its interface.

You'll need **Git**, **Rust stable**, **Node.js 22.12+** (or a newer compatible LTS release), and the native build dependencies for your operating system. Install **Python 3** if you plan to use Python extensions; it is not required to compile Mocu itself.

See the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for platform-specific requirements and troubleshooting. The commands below install development tools on your machine; review them before running them.

### Windows · PowerShell

Install the toolchain:

```powershell
winget install --id Git.Git -e
winget install --id Rustlang.Rustup -e
winget install --id OpenJS.NodeJS.LTS -e

# Optional: needed for Python extensions
winget install --id Python.Python.3.12 -e
```

Install [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the **Desktop development with C++** workload and a Windows SDK. Tauri also requires **Microsoft Edge WebView2**, usually already installed on modern Windows.

Open a new terminal after installation so the tools are available on `PATH`.

### macOS · Terminal

Install the Xcode Command Line Tools, and wait for installation to finish:

```bash
xcode-select --install
```

With [Homebrew](https://brew.sh/) installed:

```bash
brew install git node@22
brew link --overwrite node@22

# Optional: needed for Python extensions
brew install python

# Install Rust, then follow the installer prompts
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
```

If another Node version is already installed, use your version manager or follow Homebrew's PATH instructions instead of relinking it. Desktop and screen-related tools may need macOS privacy permissions.

### Linux · Ubuntu / Debian

Install native dependencies (package names may vary by distribution):

```bash
sudo apt update
sudo apt install -y git curl wget file build-essential pkg-config \
  libwebkit2gtk-4.1-dev libssl-dev libayatana-appindicator3-dev \
  librsvg2-dev libxdo-dev libx11-dev libxi-dev libxtst-dev

# Optional: needed for Python extensions
sudo apt install -y python3 python3-pip python3-venv

# Install Rust, then follow the installer prompts
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"

# Install Node.js 22 using nvm; review the installer before running it
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm install 22
nvm use 22
```

Use a distribution that provides WebKitGTK 4.1. Other distributions need equivalent packages; see the Tauri prerequisites. Screen capture and input tools may have limitations depending on your desktop session, especially Wayland.

### Clone, run, and build

After installing the prerequisites, run these commands on **Windows, macOS, or Linux**:

```bash
git clone https://github.com/kharchangai/Mocu.git
cd Mocu
npm install

# Launch the full desktop app in development mode
npm run tauri dev
```

To create an installable package for the operating system you're building on, stop the development app and run:

```bash
npm run tauri build
```

Build output is normally under `src-tauri/target/release/bundle/`. Build on the target operating system; this command is not a cross-platform installer generator. Signing or distribution requirements may need additional platform-specific setup.

Python extension dependencies must be installed separately according to each extension's instructions; Mocu does not automatically run `pip install`.

---

## Help shape the alpha

Mocu is still an **alpha**, not a finished or production-stable product. Your feedback helps turn the idea into a better everyday workspace.

**[Report bugs and share feedback on GitHub Issues →](https://github.com/kharchangai/Mocu/issues)**

A useful bug report includes:

- Your operating system and Mocu version.
- What you expected and what actually happened.
- Steps to reproduce the issue.
- Relevant logs or screenshots, with API keys and personal information removed.

Review generated code and tool actions, use trusted extensions, and back up important files before testing workflows that modify them.

## Learn more

- [User guide](install-resources/docs/mocu-user-guide.md)
- [Agents](install-resources/docs/mocu-agents.md) · [Skills](install-resources/docs/mocu-skills.md)
- [Extensions](install-resources/docs/mocu-extensions.md) · [Extension development](install-resources/docs/mocu-extension-development.md)
- [Knowledge docs](install-resources/docs/mocu-knowledge-docs.md) · [Notes](install-resources/docs/mocu-notes.md)
- [Scheduling](install-resources/docs/mocu-schedule.md) · [Projects and memory](install-resources/docs/mocu-projects.md)
- [Focus and Step-by-Step](install-resources/docs/mocu-chat-commands.md) · [MCP](install-resources/docs/mocu-mcp.md)

## License

Mocu is licensed under the [Apache License 2.0](LICENSE).

---

**Your work. Your AI team. More of what you can do.**