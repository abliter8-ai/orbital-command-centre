---
title: "IP-004 Antigravity AgentHandle + delegate_to_antigravity"
date: 2026-08-19
status: approved (2026-08-19, David: build Antigravity adapter now; headless agy -p, not TUI)
slug: antigravity-handle-mcp
idea_ref: docs/source-refs/antigravity-cli/headless.md
---

# IP-004 — Antigravity AgentHandle + delegate_to_antigravity

## Scope

**In:** `@occ/adapter-antigravity` over `agy -p --output-format json`; `delegate_to_antigravity`; skill; copy source-refs.

**Out:** Interactive TUI (`agy` / `-i`); ACP; exposing `google_search` / `read_url` / `execute_url` / `/browser` as OCC tools (they stay Antigravity-native, steered in the brief + settings.json).

## Transport (live 1.1.15)

`AGY_BIN` or `agy` — never `gemini` (that's a different CLI). No `--cwd` flag; spawn cwd is the workspace.

```
agy -p <brief> --output-format json --print-timeout <Ns>
    [--mode plan|accept-edits] [--dangerously-skip-permissions]
    [--model <slug>] [--effort low|medium|high] [--conversation <id>]
```

JSON: `{ conversation_id, status, response, error, duration_seconds, usage }`. Models from `agy models` (health uses `--version` only — do not probe `agy models` before a `-p` turn). Effort on the CLI is `low|medium|high`; OCC `xhigh`/`max` map to `high`.

## Sandbox mapping

| OCC | agy |
| --- | --- |
| `read-only` | `--mode plan` |
| `workspace-write` (default) | `--mode accept-edits` (file writes; shell still soft-deny) |
| `danger-full-access` | `--mode accept-edits --dangerously-skip-permissions` |

Do not pass `--sandbox` unless we later prove it does not hang headless. Native web tools need `permissions.allow` or danger-full-access.

## Success

`occ_health` lists antigravity. `delegate_to_antigravity` with a read-only PING returns `status: succeeded` and `output` containing `PING`.
