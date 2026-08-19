---
title: "IP-003 Grok AgentHandle + delegate_to_grok"
date: 2026-08-19
status: approved (2026-08-19, David: build Grok plugin now; headless grok -p, not ACP)
slug: grok-handle-mcp
idea_ref: docs/source-refs/grok-build.md
---

# IP-003 — Grok AgentHandle + delegate_to_grok

## Scope

**In:** `@occ/adapter-grok` over `grok -p --output-format json`; `delegate_to_grok`; skill; copy source-refs.

**Out:** ACP (`grok agent stdio`); exposing Imagine/X/web as OCC tools (they stay Grok-native, steered in the brief).

## Transport (live 1.0.5)

`GROK_BIN` or `grok` — never `agent`.

```
grok --no-auto-update --no-alt-screen --output-format json --verbatim --cwd <cwd>
     [--always-approve] [--sandbox read-only|workspace] [-m <model>] [--effort <level>]
     [-r <sessionId>] -p <brief>
```

JSON: `{ text, sessionId, stopReason, usage }`. Models from `grok models`. Effort: `--effort` (`low|medium|high|xhigh|max`).
