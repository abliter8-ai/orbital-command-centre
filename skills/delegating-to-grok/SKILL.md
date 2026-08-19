---
name: delegating-to-grok
description: >
  Use when Claude should offload implementation, investigation, live X/web, or
  Imagine work to Grok via Orbital OCC MCP (delegate_to_grok, occ_health), pick
  a Grok CLI model (grok-4.6, grok-4.5, local aliases), set reasoning effort
  (low/medium/high/xhigh/max), resume a Grok session, or after Grok errors such
  as "not logged in", "Device not configured", or spawn of the `agent` binary.
---

# Delegating to Grok (OCC)

Claude plans and reviews. Grok runs via **`grok -p --output-format json`**, not
ACP (`grok agent stdio`), not `delegate_to_codex` / `delegate_to_cursor`. Tool:
`delegate_to_grok` on the **orbital** MCP server.

**Prerequisite:** orbital MCP connected. `grok` on PATH (override with `GROK_BIN`).
Never spawn `agent` when you meant Cursor — that name is Grok.

## When to use

- User asked for **Grok**
- Live **X** posts (native X tools, not a web scrape of x.com)
- Open web (`web_search` / `web_fetch`)
- Imagine (`image_gen` / `image_edit` / `image_to_video` / `reference_to_video`)
- Follow-up on a prior Grok thread (`resume_session_id`)

**Do not use** for architecture calls, reviewing Grok's own diff, or when the
user asked for Codex or Cursor.

## Always: health, then a self-contained brief

1. Call `occ_health`. Grok must be `available` **and** `authenticated`.
2. Call `delegate_to_grok` with a brief Grok can run **without this chat**.
3. Review `status`, `output`, `filesChanged`, `error`.

### Brief

Goal, constraints (files), definition of done, non-goals. Never dump the chat.
Never assume Grok sees Claude's tools or MCP.

Native tools are **not** OCC tools. Name them in the brief. OCC always passes
`--always-approve --verbatim`.

## Pick a model

Headless flag: `-m`. OCC default if omitted: **`grok-4.6`** (CLI default).

| `model` | Use for |
| --- | --- |
| omit / `grok-4.6` | Frontier Grok. Prefer this. |
| `grok-4.5` | Previous gen |
| local aliases (`dsv4-*`, `glm-5-2`, `minimax-m3`, …) | Only if `occ_health` / `grok models` listed them **this session**. Extraction / cheap bulk — not frontier reasoning. |

**Do not pass:** Codex slugs (`gpt-5.6-luna` / terra / sol) or Cursor slugs
(`auto`, `gpt-5`, `sonnet-4-thinking`).

## Pick reasoning effort

Maps to `grok --effort`. Omit → Grok default.

| `effort` | When |
| --- | --- |
| `low` | Tight, obvious task; health/PING |
| `medium` | Everyday implement |
| `high` | Multi-step, several files, non-obvious |
| `xhigh` | Extra-high reasoning, still one agent |
| `max` | Hardest **single** task |

## Native tools (steer in the brief)

| Need | Say in the brief |
| --- | --- |
| Open web | "Search the web for …" / `web_fetch` a full URL |
| Live X posts | "Search X", handle with `from:`, **Latest**, window. Do **not** say "web search" |
| New still | `image_gen` + aspect + "Print the saved path." |
| Edit a still | `image_edit` + **absolute path** + what must stay |
| Video | No text-to-video. Stage frame 1, then `image_to_video` (6s prefer / 10s, 480p default / 720p) |

Recipes: `docs/source-refs/grok-p-web-search.md`, `grok-p-x-search.md`, `grok-p-imagine.md`.

## Other tool fields

| Field | Notes |
| --- | --- |
| `cwd` | Absolute path of the **target repo**. Pass it. |
| `sandbox` | grok 1.0.5 OS `--sandbox` hangs headless, so OCC does not pass it. `read-only` omits `--always-approve`. `workspace-write` / `danger-full-access` pass `--always-approve`. Always `--no-leader`. |
| `resume_session_id` | Prior result `sessionId` |
| `timeout_ms` | Default 600000, max 1800000 |

You do not spawn `grok` yourself.

## Worked call

```json
{
  "brief": "Goal: reply with the word PING.\nRead only. Do not edit files.\nDone: the single word PING.",
  "cwd": "/Users/roo/Developer/a8-agent-client-protocol/a8-orbital-command-centre",
  "model": "grok-4.6",
  "effort": "low",
  "sandbox": "read-only"
}
```

X (not web):

```json
{
  "brief": "Search X for the latest posts from @AnthropicAI. Use X keyword search from:AnthropicAI, Latest mode, last 7 days. List 10: date, URL, gist. Do not use generic web search.",
  "cwd": "/Users/roo/Developer/a8-agent-client-protocol/a8-orbital-command-centre",
  "sandbox": "read-only"
}
```

## After the tool returns

- `succeeded` — still review `filesChanged` (often empty; Grok JSON has no file list — use `diffStat`)
- `not_authenticated` / not logged in — `grok login`
- `timeout` — tighter brief or higher `timeout_ms`
- Empty `filesChanged` on an implement brief — re-brief with explicit file paths

## Decision cheat sheet

```
User asked for Codex?           → delegate_to_codex
User asked for Cursor?          → delegate_to_cursor
User asked for Grok / live X / Imagine / current web? → this tool
Investigate only?               → grok-4.6 + low + read-only
Everyday implement?             → grok-4.6 + medium + workspace-write
Continue same Grok thread?      → resume_session_id
```

## Red flags

- Passing `gpt-5.6-luna` because Codex uses it
- Spawning `agent` or `grok agent stdio` when the MCP tool exists
- Saying "web search" when you want live X posts
- Dumping the conversation into `brief`
- Treating Imagine as an OCC tool instead of naming it in the brief

## Common mistakes

| Excuse | Reality |
| --- | --- |
| "`agent` is Cursor" | `agent` is Grok when `~/.grok/bin` is on PATH. Cursor is `cursor-agent`. |
| "I'll copy Codex model slugs" | Different catalog. Grok wants `grok-4.6` / `grok-4.5`. |
| "I'll call an OCC web_search tool" | Native tools stay inside Grok. Put them in the brief. |
| "Grok already has the repo" | It has `cwd` + the brief. Nothing else. |
