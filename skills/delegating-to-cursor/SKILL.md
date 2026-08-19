---
name: delegating-to-cursor
description: >
  Use when Claude should offload implementation or investigation to Cursor via
  Orbital OCC MCP (delegate_to_cursor, occ_health), pick a Cursor CLI model
  (auto, gpt-5, sonnet-4-thinking, parameterized slugs with effort=), resume a
  Cursor session, or after Cursor errors such as "Authentication required",
  "Cannot use this model", "keychain is locked", or "Not logged in".
---

# Delegating to Cursor (OCC)

Claude plans and reviews. Cursor implements via **`cursor-agent -p`**, not ACP,
not `delegate_to_codex`, not `agent` (that name is **Grok** when `~/.grok/bin`
is on PATH). Tool: `delegate_to_cursor` on the **orbital** MCP server.

**Prerequisite:** orbital MCP connected. `cursor-agent` on PATH (override with
`CURSOR_BIN`). OCC sets `AGENT_CLI_CREDENTIAL_STORE=file` on spawned processes
so a locked macOS keychain does not kill the CLI — that store must itself be
logged in (`AGENT_CLI_CREDENTIAL_STORE=file cursor-agent login`).

## When to use

- Implementation you want done by **Cursor**, not Codex
- Read-only repo Q&A (`sandbox: "read-only"` → `--mode ask`)
- Follow-up on a prior Cursor thread (`resume_session_id`)

**Do not use** for architecture calls, reviewing Cursor's own diff, or when the
user asked for Codex.

## Always: health, then a self-contained brief

1. Call `occ_health`. Cursor must be `available` **and** `authenticated`.
2. Call `delegate_to_cursor` with a brief Cursor can run **without this chat**.
3. Review `status`, `output`, `filesChanged`, `error`.

### Brief

Goal, constraints (files), definition of done, non-goals. Never dump the chat.
Never assume Cursor sees Claude's tools or MCP.

## Pick a model

Headless flag: `--model`. OCC default if omitted: **`auto`**.

| `model` | Use for |
| --- | --- |
| `auto` (omit) | Cursor's default picker. Prefer this unless you have a reason. |
| `gpt-5` | Documented CLI example for print mode |
| `sonnet-4-thinking` | Documented CLI example |

**Effort is not a separate OCC field.** Encode it in a parameterized slug:

```
claude-opus-4-8[context=1m,effort=high,fast=false]
```

`effort` values inside the brackets: at least `low` / `high` (CLI help). Do not
pass Codex `effort: "xhigh"` on this tool — that field exists only on
`delegate_to_codex`.

**Do not pass:**

- Codex slugs (`gpt-5.6-luna`, `gpt-5.6-terra`, `gpt-5.6-sol`)
- Desktop/ACP `modelId`s (`default`, bracketed ids from the Cursor UI)
- Invented names like `composer-2.5-fast` unless `cursor-agent models` listed them
  **this session**

Live catalog: `cursor-agent models` or `cursor-agent --list-models`. That command
requires `CURSOR_API_KEY` / `CURSOR_AUTH_TOKEN` even when `cursor-agent status`
shows OAuth login. If listing fails, stick to `auto` / `gpt-5` / `sonnet-4-thinking`.

** Use 'Cursor Grok 4.6' by default.**
    Auto
    Cursor Grok 4.6          High Fast
    Composer 2.5             Fast
    Claude Opus 5            300K High
    Claude Opus 4.8          300K High
    GPT-5.6 Sol              272K Medium
    GPT-5.5                  272K Medium
    Claude Fable 5           300K High
    Cursor Grok 4.5          High Fast
    Gemini 3.7 Flash         High
## Other tool fields

| Field | Notes |
| --- | --- |
| `cwd` | Absolute path of the **target repo**. Pass it. |
| `sandbox` | `read-only` → `--mode ask --force`; `workspace-write` (default) → `--force --trust`; `danger-full-access` → write flags + `--sandbox disabled` |
| `resume_session_id` | Prior result `sessionId` |
| `timeout_ms` | Default 600000, max 1800000 |

Prompt is on **stdin**. You do not spawn `cursor-agent` yourself.

## Worked call

```json
{
  "brief": "Goal: explain parseExecJsonl reconnect handling.\nRead only. Do not edit files.\nDone: 5–10 line answer citing the reconnect regex.",
  "cwd": "/Users/roo/Developer/a8-agent-client-protocol/a8-orbital-command-centre",
  "model": "auto",
  "sandbox": "read-only"
}
```

Implement:

```json
{
  "brief": "Goal: add a unit test for isCursorLoggedIn rejecting 'Not logged in'.\nFile: packages/adapters/cursor/test/availability.test.ts only.\nDone: pnpm test passes that file.",
  "cwd": "/Users/roo/Developer/a8-agent-client-protocol/a8-orbital-command-centre",
  "model": "gpt-5",
  "sandbox": "workspace-write"
}
```

High-effort parameterized:

```json
{ "model": "claude-opus-4-8[effort=high]", "sandbox": "workspace-write" }
```

## After the tool returns

- `succeeded` — still review `filesChanged`
- `not_authenticated` / `Authentication required` — `AGENT_CLI_CREDENTIAL_STORE=file cursor-agent login`
- `keychain is locked` — unlock keychain **or** keep file-store login
- `Cannot use this model` — slug not in this account; fall back to `auto`
- `timeout` — tighter brief or higher `timeout_ms`
- Empty `filesChanged` on an implement brief — re-brief with explicit file paths

## Decision cheat sheet

```
User asked for Codex?           → delegate_to_codex, not this skill
Investigate only?               → auto + read-only
Everyday implement?             → auto or gpt-5 + workspace-write
Need thinking / high effort?    → parameterized slug, not a Codex effort field
Continue same Cursor thread?    → resume_session_id
cursor-agent models fails API key? → use auto; do not invent slugs
```

## Red flags

- Passing `gpt-5.6-luna` because Codex uses it
- Adding `effort` as a `delegate_to_cursor` argument (it is not on this tool)
- Using `agent acp` or spawning `agent` (Grok) when you meant Cursor
- Spawning `cursor-agent -p` in the shell when the MCP tool exists
- Treating `Not logged in` as logged in
- Dumping the conversation into `brief`

## Common mistakes

| Excuse | Reality |
| --- | --- |
| "`agent status` was logged in earlier" | That may have been **Grok**. Probe `cursor-agent status`. File-store sessions also expire. |
| "I'll copy Codex model slugs" | Different catalog. Cursor wants `auto` / `gpt-5` / parameterized names. |
| "I'll set effort=high like Codex" | Put `effort=` **inside** the Cursor model slug. |
| "Cursor already has the repo" | It has `cwd` + the brief. Nothing else. |
