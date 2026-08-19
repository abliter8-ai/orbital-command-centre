---
name: delegating-to-codex
description: >
  Use when Claude should offload implementation or investigation to Codex via
  Orbital OCC MCP (delegate_to_codex, occ_health), pick a Codex model
  (gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna, gpt-5.6, gpt-5.5), set reasoning
  effort (low/medium/high/xhigh/max), resume a Codex thread, or after model
  errors such as "requires a newer version of Codex" or "not supported when
  using Codex with a ChatGPT account".
---

# Delegating to Codex (OCC)

Claude plans and reviews. Codex implements. The MCP tool is `delegate_to_codex`
on the **orbital** server — not `codex exec` in this shell, not Cursor, not Ultra.

**Prerequisite:** orbital MCP is connected (`claude mcp get orbital` → ✔). If the
tool is missing, rebuild OCC (`pnpm build` in this repo) and restart Claude.

## When to use

- Implementation that would burn Claude tokens: feature slices, tests, refactors
- Repo investigation you will then review (`sandbox: "read-only"`)
- Follow-up on a prior Codex thread (`resume_session_id`)

**Do not use** for architecture decisions, security review of Codex's own output,
or anything that must stay in Claude's judgment seat.

## Always: health, then a self-contained brief

1. Call `occ_health`. Confirm Codex `available` + `authenticated`. Read
   `config model=…` and `effort=…` from the detail string — that is the default
   if you omit `model` / `effort`.
2. Call `delegate_to_codex` with a brief Codex can run **without this chat**.
3. Review `status`, `output`, `filesChanged`, `error`. Then you integrate.

### Brief (required)

Include all four:

- **Goal** — one sentence
- **Constraints** — files in play, do-not-touch, style
- **Definition of done** — commands to run, expected result
- **Non-goals** — what not to invent

Never paste the whole conversation. Never assume Codex sees Claude's tools.

## Pick a model

ChatGPT-login slugs, Codex CLI **0.148+**. Source: [Codex models](https://developers.openai.com/codex/models).

| `model` | Use for |
| --- | --- |
| `gpt-5.6-luna` | Fast, cheap, well-specified work (extract, tests for a small unit, "reply PING") |
| `gpt-5.6-terra` | Everyday implementation; replacement for GPT-5.5 |
| `gpt-5.6-sol` | Ambiguous, high-value, multi-file, or hard debugging |
| `gpt-5.6` | Alias → sol |
| `gpt-5.5` | Previous-gen fallback if a 5.6 slug is rejected |

**Banned on ChatGPT auth (will fail the turn):**

- `gpt-5.1-codex`, `gpt-5.3-codex` — "not supported when using Codex with a ChatGPT account"
- `gpt-5.4`, `gpt-5.4-mini` after **2026-08-31** — retire; use terra / luna

If `occ_health` reports CLI **&lt; 0.148** and config default is `gpt-5.6-luna`,
**always pass `model` explicitly** (`gpt-5.5` or `gpt-5.6-terra`). Otherwise you get
`requires a newer version of Codex`.

## Pick reasoning effort

Maps to Codex `model_reasoning_effort`. Omit → `~/.codex/config.toml` (often `medium`).

| `effort` | When |
| --- | --- |
| `low` | Tight, obvious task; health/PING; single-file mechanical edit |
| `medium` | Default everyday implement |
| `high` | Multi-step, several files, non-obvious bugs |
| `xhigh` | Extra-high reasoning, still one agent |
| `max` | Hardest **single** task; slow and expensive |

**Ultra is not `effort`.** Ultra is Codex subagent fan-out. OCC does not expose it.
Do not pass `effort: "ultra"` or invent `reasoning_level`.

## Other tool fields

| Field | Values / notes |
| --- | --- |
| `cwd` | Absolute path of the **target repo**. Pass it. Default is the MCP process cwd, which may not be the workspace you think. |
| `sandbox` | `read-only` investigate; `workspace-write` (default) implement; `danger-full-access` only if you mean it |
| `resume_session_id` | Prior result's `sessionId` — same Codex thread |
| `timeout_ms` | Default `600000`, max `1800000` |

## Worked call

Implement (terra + high) in a known repo:

```json
{
  "brief": "Goal: add a failing-then-passing unit test for parseExecJsonl reconnect-ignore.\nFiles: packages/adapters/codex/test/parse-exec-jsonl.test.ts only.\nDone: pnpm test includes the new case.\nDo not change production parser unless a test proves a bug.",
  "cwd": "/Users/roo/Developer/a8-agent-client-protocol/a8-orbital-command-centre",
  "model": "gpt-5.6-terra",
  "effort": "high",
  "sandbox": "workspace-write"
}
```

Then resume: same `cwd`, `resume_session_id` = returned `sessionId`, new brief only.

## After the tool returns

- `status: succeeded` — read `filesChanged` + `output`. You still review the diff.
- `status: failed` + `not_available` / `not_authenticated` — `codex login` or PATH/`CODEX_BIN`.
- `agent_failed` containing **newer version** — CLI too old for the slug; upgrade Codex or pass `gpt-5.5`.
- `agent_failed` containing **ChatGPT account** — forbidden slug; switch to the table above.
- `timeout` — tighter brief or higher `timeout_ms`.
- Empty `filesChanged` on an implement brief — Codex may have talked instead of editing. Re-brief with "change these files" or resume.

## Decision cheat sheet

```
Need a decision / review?     → stay in Claude
Investigate only?             → luna + low + read-only
Small specified implement?    → luna or terra + medium + workspace-write
Hard / ambiguous implement?   → sol + high or xhigh + workspace-write
Continue same Codex thread?   → resume_session_id, do not start a new one
```

## Red flags

- Choosing `gpt-5.1-codex` because it "sounds like Codex"
- Omitting `model` when `occ_health` version is below 0.148 and default is luna
- Dumping the chat into `brief`
- Treating Ultra as an effort value
- Implementing without reading `filesChanged`
- Using `delegate_to_cursor` when the user asked for Codex
- Spawning `codex exec` yourself when `delegate_to_codex` is available

## Common mistakes

| Excuse | Reality |
| --- | --- |
| "I'll just use the default model" | Default is whatever `~/.codex/config.toml` says. If CLI is old, luna fails. |
| "gpt-5.1-codex is the coding model" | Rejected on ChatGPT login. Use 5.6 sol/terra/luna. |
| "Higher effort always better" | Costs time and tokens. Start medium; raise only when the first turn was thin. |
| "Codex already has the repo context" | It has `cwd` + the brief. Nothing else. |
