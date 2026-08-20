---
name: delegating-to-antigravity
description: >
  Use when Claude should offload implementation or investigation to Google
  Antigravity via Orbital OCC MCP (delegate_to_antigravity, occ_health), pick
  an agy model (gemini-3.7-flash-high, gemini-3.1-pro-high, claude-sonnet-4-6),
  set effort (low/medium/high), resume an agy conversation, or after errors
  such as "authentication required", "unknown model", or spawning `gemini`.
---

# Delegating to Antigravity (OCC)

Claude plans and reviews. Antigravity runs via **`agy -p --output-format json`**,
not the TUI, not `gemini`, not Codex/Cursor/Grok. Tool: `delegate_to_antigravity`
on the **orbital** MCP server.

**Prerequisite:** orbital MCP connected. `agy` on PATH (override with `AGY_BIN`).
There is **no `--cwd` flag** — pass `cwd` to the OCC tool; OCC spawns in that directory.

## When to use

- User asked for **Antigravity** / **agy** / Gemini-via-Google-agent-CLI
- Gemini 3.x or Claude-on-agy models
- Web research — prefer the first-class **`antigravity_research`** tool (grounded
  `google_search` + `read_url` brief, optional `fetch_pages` and `subagents`),
  which permission-pre-flights for you

**Do not use** when the user asked for Codex, Cursor, or Grok.

## Always: health, then a self-contained brief

1. Call `occ_health`. Antigravity must be `available` **and** `authenticated`.
2. Call `delegate_to_antigravity` with a brief agy can run **without this chat**.
3. Review `status`, `output`, `error`. Watch for soft-deny: SUCCESS with no real work.

## Pick a model

`agy --model`. Unknown slug → hard ERROR (no silent fallback).

| `model` | Use for |
| --- | --- |
| omit | CLI default |
| `gemini-3.7-flash-high` | Current Gemini flash, high effort baked into slug |
| `gemini-3.5-flash-medium` | Everyday |
| `gemini-3.1-pro-high` | Gemini Pro |
| `claude-sonnet-4-6` | Claude on agy |
| `claude-opus-4-6-thinking` | Claude thinking |

Effort is **also** in some slugs (`-high`/`-medium`/`-low`). `--effort` is `low|medium|high` only. OCC `xhigh`/`max` map to `high`.

## Sandbox

| OCC `sandbox` | agy |
| --- | --- |
| `read-only` | `--mode plan` |
| `workspace-write` (default) | `--mode accept-edits` (files; shell still Ask → **soft-deny**) |
| `danger-full-access` | `--mode accept-edits --dangerously-skip-permissions` |

Soft-deny + exit 0 is the failure mode: tests never ran but the tool "succeeded". Check the summary for a soft-deny hint. Prefer `danger-full-access` only in a trusted cwd.

## Native tools (name them in the brief)

| Tool | Job | Headless caveat |
| --- | --- | --- |
| `google_search` | Grounded public web search | Soft-denied unless pre-allowed or danger-full-access |
| `read_url` | Fetch/process a page | Default Ask → soft-deny. Pre-allow per below |
| `execute_url` | Drive a live browser (click, type, read DOM) | Same; heavier — prefer `read_url` when static fetch suffices |
| subagents | Parallel research fan-out | Works headless; ask for it in the brief |

Web actions default to **Ask**, which headless turns into a silent soft-deny
(exit 0, no work, notice on stderr). Three fixes:

1. `antigravity_research` with `preflight: "check"` (default) tells you exactly
   which rules are missing; `"fix"` merges `read_url(*)` into
   `~/.gemini/antigravity-cli/settings.json` with a timestamped backup —
   including when the existing file is malformed (original bytes preserved).
2. Pre-allow by hand in `~/.gemini/antigravity-cli/settings.json`:

```json
{ "permissions": { "allow": ["read_url(*)"] } }
```

3. Or `sandbox: "danger-full-access"` (adds `--dangerously-skip-permissions`)
in a trusted cwd.

Recipes and flag details: `docs/source-refs/agy-tools-ref.md`. For live **X**
posts or media generation, route to Grok instead (`grok_x_search`,
`grok_imagine`) — `occ_capabilities` shows who owns what.

## Resume

Pass prior `sessionId` (`conversation_id`) as `resume_session_id`. Conversations are **cwd-scoped**.

## Worked call

```json
{
  "brief": "Goal: reply with the word PING.\nRead only. Do not edit files.\nDone: the single word PING.",
  "cwd": "/Users/roo/Developer/a8-agent-client-protocol/a8-orbital-command-centre",
  "sandbox": "read-only",
  "effort": "low"
}
```

## Red flags

- Spawning `gemini` or `agy` in this shell when the MCP tool exists
- Passing `gpt-5.6-luna` or `grok-4.6`
- Assuming tests ran on workspace-write without allow-rules or danger-full-access
- Passing `--cwd` as if it were an agy flag

## Common mistakes

| Excuse | Reality |
| --- | --- |
| "`gemini` is Antigravity" | Different CLI. Binary is `agy`. |
| "It exited 0 so tests ran" | Soft-deny. Check summary / stderr. |
| "I'll use `--permission-mode`" | Gemini CLI leftover. agy uses `--mode` + settings.json. |
