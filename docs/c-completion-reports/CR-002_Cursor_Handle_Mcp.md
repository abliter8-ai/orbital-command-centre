---
title: "CR-002 Cursor AgentHandle + delegate_to_cursor"
date: 2026-08-19
plan_ref: IP-002_Cursor_Handle_Mcp.md
status: complete
testing:
  unit: true
  integration: true
  manual: true
deployed:
  production: false
context_updated: true
---

# CR-002 — Cursor AgentHandle + delegate_to_cursor

## Summary

Second adapter is live on `feat/ip-002-cursor-adapter`. OCC now registers Codex and Cursor on the same MCP server. Cursor is `agent -p` (not ACP). Shared spawn lives in `@occ/adapter-kit`; Codex was moved onto it.

## Evidence by plan step

### AgentId + kit + Codex refactor

`AgentId` is `"codex" | "cursor"`. New package `@occ/adapter-kit` (`runChild`, cwd, timeouts). Codex `run-exec.ts` is a thin wrapper.

### Cursor handle

`@occ/adapter-cursor` implements `AgentHandle`. Flags match live `agent --help` 2026.08.11-e8db854 and cc-multi-cli-plugin:

- read-only → `-p --mode ask --force --output-format json`
- workspace-write → `-p --force --trust --output-format stream-json`
- danger-full-access → write flags + `--sandbox disabled`

Prompt on stdin. Spawn env sets `AGENT_CLI_CREDENTIAL_STORE=file`.

### MCP

`delegate_to_cursor` plus generic `runDelegate`. `occ_health` lists both.

### Automated

`pnpm test` (2026-08-19):

```
Test Files  12 passed (12)
     Tests  35 passed (35)
```

`pnpm typecheck` and `pnpm build` exited 0.

### Live smoke (ruin-max, 2026-08-19)

`CursorAgentHandle.isAvailable()`:

```json
{
  "available": true,
  "authenticated": true,
  "detail": "2026.08.11-e8db854 — ✓ Logged in as learntosmoke23@gmail.com",
  "version": "2026.08.11-e8db854"
}
```

Read-only brief “Reply with the word PING and do not change any files.” in a temp cwd:

```json
{
  "status": "succeeded",
  "sessionId": "e785971b-e8b9-41d4-8bcc-c359ec14412e",
  "output": "PING",
  "filesChanged": [],
  "durationMs": 17798
}
```

`agent --version` / `--help` fail if the login keychain is locked. File credential store made both the probe and the turn work without unlocking.

## Deviations from plan

None material. Shared kit is `@occ/adapter-kit` under `packages/adapters/kit` as specified.

## Known issues & follow-ons

- Claude Code still needs `claude mcp add` (same as CR-001).
- IP-001 branch is not on `main`; this branch is stacked on it.
- No Grok / OpenCode / ACP / A2A yet.

## David's manual checklist

1. Merge `feat/ip-001-core-handle-codex-mcp` then this branch (or merge this branch, which contains both).
2. After `pnpm build`:  
   `claude mcp add orbital -- node "$(pwd)/packages/mcp-facade/dist/stdio.js"`
3. `occ_health` should show both agents. `delegate_to_cursor` with `sandbox: "read-only"` for a first live Claude call.

## Rollback

```bash
git checkout feat/ip-001-core-handle-codex-mcp
```

Or `git checkout main` if neither branch is merged.
