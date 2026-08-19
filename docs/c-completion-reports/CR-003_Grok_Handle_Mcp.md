---
title: "CR-003 Grok AgentHandle + delegate_to_grok"
date: 2026-08-19
plan_ref: IP-003_Grok_Handle_Mcp.md
status: complete
testing:
  unit: true
  integration: true
  manual: true
deployed:
  production: false
context_updated: true
---

# CR-003 — Grok AgentHandle + delegate_to_grok

## Summary

Third adapter is live on `feat/ip-003-grok-adapter`. OCC registers Codex, Cursor, and Grok on the same MCP server. Grok is headless `grok -p --output-format json` (not ACP). Native X / web / Imagine stay inside Grok — steered in the brief.

## Evidence by plan step

### AgentId + handle

`AgentId` is `"codex" | "cursor" | "grok"`. New package `@occ/adapter-grok`. Binary is `GROK_BIN` or `grok` — never `agent`.

Spawn (live 1.0.5):

```
grok --no-auto-update --no-alt-screen --no-leader --output-format json --verbatim
     [--always-approve] [-m <model>] [--effort <level>] [-r <sessionId>] -p <brief>
```

JSON: `{ text, sessionId, stopReason, usage }`.

### MCP

`delegate_to_grok` plus `HINTS.grok`. `occ_health` lists three agents. Skill: `skills/delegating-to-grok/` (symlinked from `.claude/skills/`).

### Automated

`pnpm test` (2026-08-19):

```
Test Files  17 passed (17)
     Tests  58 passed (58)
```

`pnpm --filter @occ/mcp-facade build` exited 0.

### Live smoke (ruin-max, 2026-08-19)

`GrokAgentHandle.isAvailable()` then read-only PING (temp cwd):

```
AVAIL {"available":true,"authenticated":true,"version":"1.0.5",
  "detail":"grok 1.0.5 (5115b46bc909) [stable] — authenticated · bin=grok · default model=grok-4.6 · slugs: grok-4.6|grok-4.5 · effort via --effort"}
```

```
status: succeeded
sessionId: 01a019ca-3331-7b63-95ab-5a1cc0ba3d39
output: PING
durationMs: 19342
```

Prompt-only (no health probe first) was **10056ms**. The model is not slow; the hangs below were CLI flags / leader / `grok models`.

## Deviations from plan

IP said `--always-approve` and `--sandbox read-only|workspace` together. Live 1.0.5:

| Combo | Result |
| --- | --- |
| `--no-leader -p --output-format json --verbatim` | PING in ~8–10s |
| `--sandbox` (any non-off) | empty stdout until SIGTERM |
| `--always-approve` + `--sandbox` | hang |
| `grok models` then `grok -p` | hang (health was poisoning prompt) |
| child inheriting `GROK_SESSION_ID` | hang (nested in this Grok session) |

OCC therefore:

- always `--no-leader`
- never OS `--sandbox`
- `--always-approve` only on write (`workspace-write` / `danger-full-access`)
- spawn cwd from `runChild`, not `--cwd`
- strip `GROK_AGENT` / `GROK_SESSION_ID` / `GROK_AGENT_NAME`
- health uses `grok --no-leader --version` only — not `grok models`

ACP (`grok agent stdio`) still out of scope. Native tools still brief-only.

## Known issues & follow-ons

- Health catalog is static (`grok-4.6|grok-4.5`). Live local aliases exist (`dsv4-*`, `glm-5-2`, `minimax-m3`) but listing them via `grok models` hangs the next `-p`.
- `filesChanged` is usually empty; Grok JSON has no file list. Use `diffStat`.
- Claude Code must restart the orbital MCP session to see `delegate_to_grok`. Same stdio entry; no `claude mcp add`.

## David's manual checklist

1. Restart the Claude Code session that owns **orbital** MCP (reload tools). Do not re-add the server.
2. `occ_health` should list `grok` as available + authenticated.
3. First live Claude call: `delegate_to_grok` with `sandbox: "read-only"` and brief “Reply with the word PING and do not change any files.”

## Rollback

```bash
git checkout feat/ip-002-cursor-adapter
```
