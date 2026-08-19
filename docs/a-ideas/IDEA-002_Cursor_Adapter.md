# IDEA-002 — Cursor as a second AgentHandle

**Date:** 2026-08-19 · **Status:** ready-for-ip

## Problem / opportunity

IP-001 closed Claude → Codex. A single handle cannot prove the façade is agent-agnostic. Cursor is installed on ruin-max (`agent` 2026.08.11-e8db854) and is the next named target in `AGENTS.md`.

## Current state

- `@occ/adapter-codex` works via `codex exec --json`.
- `cc-multi-cli-plugin` already runs Cursor as `agent -p` and abandoned `agent acp` (MCP tools / cancel).
- This box: `/Users/roo/.local/bin/agent` → `cursor-agent` 2026.08.11-e8db854. `agent status` reports logged in as `learntosmoke23@gmail.com` when `AGENT_CLI_CREDENTIAL_STORE=file`. Unset, the CLI dies on a locked login keychain.

## Desired outcome

`delegate_to_cursor` on the same MCP server, same `AgentHandle` contract. Codex still works.

## Next step

IP-002.
