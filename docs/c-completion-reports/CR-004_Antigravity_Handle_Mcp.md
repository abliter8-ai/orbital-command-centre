---
title: "CR-004 Antigravity AgentHandle + delegate_to_antigravity"
date: 2026-08-19
plan_ref: IP-004_Antigravity_Handle_Mcp.md
status: complete
testing:
  unit: true
  integration: true
  manual: true
deployed:
  production: false
context_updated: true
---

# CR-004 — Antigravity AgentHandle + delegate_to_antigravity

## Summary

Fourth adapter is on `feat/ip-004-antigravity-adapter`. OCC registers Codex, Cursor, Grok, and Antigravity. Antigravity is headless `agy -p --output-format json` (not the TUI, not `gemini`). Native web/browser tools stay inside agy.

## Evidence by plan step

### Handle

`AgentId` is `"codex" | "cursor" | "grok" | "antigravity"`. Package `@occ/adapter-antigravity`. Binary `AGY_BIN` or `agy`.

Spawn (live 1.1.15):

```
agy -p <brief> --output-format json --print-timeout <Ns>
    --mode plan|accept-edits [--dangerously-skip-permissions]
    [--model] [--effort] [--conversation]
```

No `--cwd` (not a flag). JSON: `{ conversation_id, status, response, error, usage }`.

### MCP

`delegate_to_antigravity` plus `HINTS.antigravity`. Skill: `skills/delegating-to-antigravity/`.

### Automated

`pnpm test` (2026-08-19):

```
Test Files  21 passed (21)
     Tests  74 passed (74)
```

`pnpm typecheck` and `pnpm build` exited 0.

### Live smoke (ruin-max, 2026-08-19)

`agy -p` JSON plan-mode PING (temp cwd, 22s):

```json
{"conversation_id":"5afb4328-247d-4a76-b085-706562748734","status":"SUCCESS","response":"PING\n"}
```

`AntigravityAgentHandle` health + prompt:

```
AVAIL {"available":true,"authenticated":true,"version":"1.1.15"}
status: succeeded
sessionId: 3694a3bf-a720-4186-b78d-e5626ddda431
output: PING
durationMs: 10483
```

## Deviations from plan

None material. Health uses `agy --version` only (not `agy models`), same lesson as Grok. `--sandbox` not passed. `--dangerously-skip-permissions` only on OCC `danger-full-access`.

## Known issues & follow-ons

- Soft-deny + exit 0: workspace-write can succeed without running shell. Summary flags stderr matches; prefer danger-full-access or `permissions.allow` for tests.
- Health catalog is static (live slugs from this machine).
- Claude must restart orbital MCP to see the new tool.

## David's manual checklist

1. Restart the Claude session that owns **orbital**.
2. `occ_health` should list `antigravity` available + authenticated.
3. First Claude call: `delegate_to_antigravity` with `sandbox: "read-only"` and a PING brief.

## Rollback

```bash
git checkout main
```
