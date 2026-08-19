# Antigravity CLI overview

Source: [https://antigravity.google/docs/cli/overview/](https://antigravity.google/docs/cli/overview/) (fetched 2026-08-19).

The Antigravity CLI (`agy`) is the TUI surface of Antigravity. Same agent harness as Antigravity 2.0 (multi-step reasoning, multi-file editing, tool calling, conversation history), built for terminal-first, SSH, and **headless** use.

## CLI vs Antigravity 2.0

| | Antigravity CLI | Antigravity 2.0 |
|---|-----------------|-----------------|
| Interface | Keyboard TUI | Visual desktop editor / IDE |
| Overhead | Near-zero | Full IDE |
| Focus | Fast local iterations, SSH, **headless** | Visual workspace / project management |
| Remote | Native SSH, tmux | Local or remote-dev containers |

They share:

- **Agent harness** — reasoning, tools, code comprehension
- **Settings / permissions** — `~/.gemini/antigravity-cli/settings.json` syncs across both
- **Conversation export** — a CLI thread can be imported into 2.0 via the session picker (Tab → Antigravity tab)

Gemini CLI users: one-time import of extensions, skills, and settings — [Migrating from Gemini CLI](https://antigravity.google/docs/cli/gcli-migration).

## Docs map (CLI)

| Topic | URL |
|-------|-----|
| Install & auth | https://antigravity.google/docs/cli/install |
| Getting started | https://antigravity.google/docs/cli/getting-started |
| **Headless / print mode** | https://antigravity.google/docs/cli/headless |
| Execution modes | https://antigravity.google/docs/cli/modes |
| Permissions | https://antigravity.google/docs/cli/permissions |
| Sandbox | https://antigravity.google/docs/cli/sandbox |
| Conversations / resume | https://antigravity.google/docs/cli/conversations · https://antigravity.google/docs/cli/commands/resume |
| Projects | https://antigravity.google/docs/cli/projects |
| Subagents | https://antigravity.google/docs/cli/subagents |
| Reference (slash + settings keys) | https://antigravity.google/docs/cli/reference |
| Best practices | https://antigravity.google/docs/cli/best-practices |
| Plugins | https://antigravity.google/docs/cli/plugins |

Print-mode contract: [headless.md](./headless.md).
