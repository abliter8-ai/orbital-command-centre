---
title: "IP-002 Cursor AgentHandle + delegate_to_cursor"
date: 2026-08-19
status: approved (2026-08-19, Cursor via agent -p; shared kit; not ACP)
slug: cursor-handle-mcp
idea_ref: IDEA-002_Cursor_Adapter.md
---

# IP-002 — Cursor AgentHandle + delegate_to_cursor

David selected Cursor as the second adapter (2026-08-19). Decisions below are the recommended defaults from that direction.

## Problem Statement

OCC only exposes Codex. The MCP façade still special-cases one agent in practice (`runDelegateToCodex`, hardcoded “Codex delegation”). A second handle is what makes `AgentHandle` real.

## Scope

**In:**

- Widen `AgentId` to `"codex" | "cursor"`
- `@occ/adapter-kit`: shared child spawn, cwd check, timeouts (no protocol types)
- Move Codex spawn onto the kit
- `@occ/adapter-cursor`: `agent -p` (prompt on stdin)
- MCP tool `delegate_to_cursor`; `occ_health` lists both
- Contract tests + optional live PING

**Out:**

- `agent acp` (cc-multi-cli-plugin dropped it)
- Grok, OpenCode, Pi
- A2A / ACP façades, daemon, worktrees (`agent --worktree`)
- Copying the Codex app-server broker

## Approach

Transport from `vendored/cc-multi-cli-plugin` `cursor.mjs`, verified against live `agent --help` 2026.08.11-e8db854:

| OCC sandbox | Cursor flags | stdout |
| --- | --- | --- |
| `read-only` | `-p --mode ask --force --output-format json` | one JSON result |
| `workspace-write` (default) | `-p --force --trust --output-format stream-json --stream-partial-output` | NDJSON |
| `danger-full-access` | same as write + `--sandbox disabled` | NDJSON |

Always: `--model <id|auto>`, `--workspace <cwd>`, `--resume <id>` when not pending. Prompt on **stdin**, never argv.

Spawn env: `AGENT_CLI_CREDENTIAL_STORE=file` unless already set. Unset, this CLI exits on a locked login keychain (observed 2026-08-19).

Parse (from their tests + `normalizeHeadlessOutcome`):

- json: `{ type:"result", result, session_id, is_error }`
- stream-json: last `type=="result"`; file changes from completed `*ToolCall` keys matching write/edit/create/delete/move/rename/patch/replace **and** a path

Binary: `CURSOR_BIN` or `agent`.

## File map

```
packages/adapters/kit/          # @occ/adapter-kit
packages/adapters/cursor/       # @occ/adapter-cursor
packages/core/src/types.ts      # AgentId union
packages/adapters/codex/        # use kit
packages/mcp-facade/            # second tool + generic delegate
```

## Implementation steps

1. `AgentId = "codex" | "cursor"`. Fake handle takes `agentId` from overrides.
2. Kit: `runChild`, `commandForBin`, `validateCwd`, timeout constants. Codex `run-exec` becomes a wrapper.
3. Cursor parser + `buildHeadlessArgs` + handle + `fake-agent.mjs` stub.
4. `runDelegate(registry, store, agentId, input)`. Register both handles. `delegate_to_cursor`.
5. README / AGENTS.md. Live smoke: read-only PING if `agent status` is logged in.

## Risks

| Risk | Mitigation |
| --- | --- |
| Keychain locked | Default `AGENT_CLI_CREDENTIAL_STORE=file`; health detail names the lock if `--version` still fails |
| ACP temptation | Out of scope. Headless only |
| `--sandbox` meaning differs from Codex | Map only `danger-full-access` → Cursor `--sandbox disabled` |
| Live smoke blocked | CR `manual: false` with the keychain/auth error — not a fake pass |

## Decisions (taken)

1. Cursor via `agent -p`, not ACP.
2. Shared `@occ/adapter-kit`.
3. Default write = `--force --trust` (their delegate role). Not `--yolo` as a separate flag.
4. File-backed Cursor credential store for OCC-spawned processes.
