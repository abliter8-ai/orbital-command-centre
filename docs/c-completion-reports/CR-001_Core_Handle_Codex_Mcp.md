---
title: "CR-001 Core AgentHandle + Codex adapter + MCP façade"
date: 2026-08-19
plan_ref: IP-001_Core_Handle_Codex_Mcp.md
status: complete
testing:
  unit: true
  integration: true
  manual: true
deployed:
  production: false
context_updated: true
---

# CR-001 — Core AgentHandle + Codex adapter + MCP façade

## Summary

IP-001 is implemented on `feat/ip-001-core-handle-codex-mcp`. OCC now has a pnpm TypeScript workspace with `@occ/core` (AgentHandle, registry, in-memory task store), `@occ/adapter-codex` (`codex exec --json`), and `@occ/mcp-facade` (`occ_health`, `delegate_to_codex` over `@prefecthq/fastmcp-ts` stdio). Unit tests, an in-process FastMCP client test, and a live read-only Codex PING on ruin-max all passed.

## Evidence by plan step

### 0. Docs into the OCC repo

Copied IDEA-001, IP-001 (approved), starting-overview, source-refs, and IDEA/IP/CR/HANDOFF templates into `docs/`. `AGENTS.md` and `README.md` now point at in-repo `docs/`. Parent workbench left in place.

### 1. Monorepo skeleton

`package.json` (private, `packageManager: pnpm@10.33.0`), `pnpm-workspace.yaml`, `tsconfig.base.json` (TypeScript 7.0.2, NodeNext, strict), `vitest.config.ts`, `.nvmrc` (`22`). Packages: `@occ/core`, `@occ/adapter-codex`, `@occ/mcp-facade`.

### 2–5. Core, parser, adapter, MCP

`pnpm test` (2026-08-19, after the sandbox-flag fix):

```
Test Files  8 passed (8)
     Tests  19 passed (19)
```

Includes FakeAgentHandle contract tests, JSONL fixtures (success / fail / reconnect ignored), fake-codex PATH stub, `runHealth` / `runDelegateToCodex`, and `Client.connect(server)` against a fake handle.

`pnpm typecheck` and `pnpm build` exited 0. `packages/mcp-facade/dist/stdio.js` exists.

### 6. Claude Code wiring + docs

`.mcp.json` added. README documents `pnpm build` → `claude mcp add orbital -- node "$(pwd)/packages/mcp-facade/dist/stdio.js"` → `occ_health` → `delegate_to_codex`. `AGENTS.md` no longer tells agents to depend on vendored FastMCP.

### Live smoke (ruin-max, 2026-08-19)

`CodexAgentHandle.isAvailable()`:

```json
{
  "available": true,
  "authenticated": true,
  "detail": "codex-cli 0.148.0",
  "version": "0.148.0"
}
```

First `delegate` attempt failed: Codex 0.148 rejects `--sandbox` combined with `--approve-for-me` (see Deviations). After the adapter fix, read-only brief “Reply with the word PING and do not change any files.” in a temp cwd:

```json
{
  "status": "succeeded",
  "sessionId": "01a018f4-40d5-72b0-984b-4af677b24841",
  "output": "PING",
  "filesChanged": [],
  "durationMs": 5078
}
```

Claude Code itself was not launched in this session. MCP stdio was verified in-process (`server.test.ts`) and via the handle used by the façade. Registering with `claude mcp add` is still a David step if he wants it in his live Claude config.

## Deviations from plan

1. **`--sandbox` + `--approve-for-me` are mutually exclusive on Codex 0.148.** IP said pass both. Live exec printed: `the argument '--sandbox <SANDBOX_MODE>' cannot be used with '--approve-for-me'`. Adapter now: `workspace-write` → `--approve-for-me` only; `read-only` / `danger-full-access` → `--sandbox` only. Same policy, legal flags.
2. **`pnpm typecheck` is sequential** (build core/adapter so dependents can resolve `@occ/core` types from `dist/`). Not a behaviour change.
3. **Docs were seeded during implementation**, not as a separate pre-code commit.
4. **Work done on `feat/ip-001-core-handle-codex-mcp` in the current checkout**, not a hidden worktree — workspace stays reviewable.

## Known issues & follow-ons

- Claude Code MCP registration (`claude mcp add orbital …`) is not done on this machine.
- No second adapter (Cursor / Grok) — IP-002.
- No ACP / A2A / daemon.
- Process-group kill is best-effort (falls back to `child.kill` if the child is not a group leader).
- `InMemoryTaskStore` dies with the stdio process (as designed).

## David's manual checklist

1. Approve/merge `feat/ip-001-core-handle-codex-mcp` if you want this on `main`.
2. From the repo root after `pnpm build`:  
   `claude mcp add orbital -- node "$(pwd)/packages/mcp-facade/dist/stdio.js"`  
   Then call `occ_health` in Claude Code.
3. Confirm Codex stays logged in on ruin-max (`codex login` if `occ_health` reports not authenticated).

## Rollback

```bash
git checkout main
git branch -D feat/ip-001-core-handle-codex-mcp   # only if the branch is unmerged and you want it gone
```

If `.mcp.json` was copied into another workspace, remove the `orbital` server (`claude mcp remove orbital`). Parent workbench docs were not deleted.
