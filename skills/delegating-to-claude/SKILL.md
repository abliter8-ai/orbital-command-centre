---
name: delegating-to-claude
description: >
  Use when an orchestrator (Claude Code, Cursor, Codex, Grok) should offload
  work to a fresh headless Claude via Orbital OCC MCP (delegate_to_claude,
  occ_health) — second-opinion review in a clean context, parallel workers,
  server-side web search/fetch, or when a non-Claude orchestrator needs
  Claude's reasoning tier. Also after errors such as "not logged in" or
  "Credit balance too low".
---

# Delegating to Claude (OCC)

Claude itself is a delegate target. The child is a **fresh headless Claude
Code** (`claude -p`), spawned clean: `--strict-mcp-config` with an empty MCP
config, so it does **not** inherit the orchestrator's MCP servers (no nested
orbital fan-out). Tool: `delegate_to_claude` on the **orbital** MCP server.

**Prerequisite:** orbital MCP connected. `claude` on PATH (override with
`CLAUDE_BIN`), logged in (`claude auth login`).

## When to use

- **Orchestrator is Cursor / Codex / Grok** and the task wants Claude's
  reasoning tier — this is the flip: those harnesses register the same orbital
  MCP server and delegate to Claude through it.
- **Orchestrator is Claude Code** and you want a second opinion from a
  clean-context Claude (no shared conversation bias), or a parallel worker on
  an independent slice.
- Server-side **WebSearch / WebFetch** — no local permission rule needed in
  `read-only` (plan) mode.
- Follow-up on a prior child thread (`resume_session_id`).

**Do not use** for work the orchestrator should do itself in-context (small
edits, questions it can answer directly) — delegation costs a full round-trip
and spends the account's own usage. The result summary reports the CLI's
API-equivalent cost meter: on claude.ai subscription auth that is a proxy for
rate-limit burn (not a charge); on API-key auth it is literal dollars.

## Sandbox mapping

| OCC sandbox | claude flag | Meaning |
| --- | --- | --- |
| `read-only` | `--permission-mode plan` | No edits, no unprompted shell |
| `workspace-write` (default) | `--permission-mode acceptEdits` | File edits auto-accept; bare shell can soft-deny |
| `danger-full-access` | `--permission-mode bypassPermissions` | Trusted cwds only |

## Models

`model` accepts the aliases `sonnet` / `opus` or full model IDs. **Do not use
the `haiku` alias**: it is broken headless and silently runs sonnet
(anthropics/claude-code#39701, open since early 2026 — there is no Haiku 5
for the alias table to land on, so it falls through to the plan default).
Pass the full ID `claude-haiku-4-5` instead. The result summary reports the
model that actually ran (from the assistant event) — trust that, never the
requested slug or the child's self-report. There is **no effort field** —
reasoning depth is baked into the model choice. `claude models` is an
interactive picker, so `scripts/update-models` refreshes only the CLI version
for this entry; the list is curated.

## Errors

- `not logged in` / `invalid api key` → `claude auth login`, then `occ_health`.
- `Credit balance too low` → account quota; the delegation failed before doing
  work.
