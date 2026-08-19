---
name: delegating-to-grok
description: >
  Use when Claude should offload implementation, investigation, live X search,
  web research, or Imagine image/video generation to Grok via Orbital OCC MCP
  (delegate_to_grok, grok_x_search, grok_imagine, grok_video, occ_health), pick
  a Grok CLI model (grok-4.6, grok-4.5, local aliases), set reasoning effort
  (low/medium/high/xhigh/max), resume a Grok session, or after Grok errors such
  as "not logged in", "Device not configured", or spawn of the `agent` binary.
---

# Delegating to Grok (OCC)

Claude plans and reviews. Grok runs via **`grok -p --output-format json`**, not
ACP (`grok agent stdio`), not `delegate_to_codex` / `delegate_to_cursor`.
Tools on the **orbital** MCP server: `delegate_to_grok` (general) plus
first-class **`grok_x_search`**, **`grok_imagine`**, **`grok_video`**.

**Prerequisite:** orbital MCP connected. `grok` on PATH (override with `GROK_BIN`).
Never spawn `agent` when you meant Cursor — that name is Grok.

## When to use

- User asked for **Grok**
- Live **X** posts → `grok_x_search` (native X index, not a web scrape)
- Image / short **video** generation → `grok_imagine` / `grok_video`
- Open web (`web_search` / `web_fetch`) → `delegate_to_grok`, name it in the brief
- Follow-up on a prior Grok thread (`resume_session_id`)

**Do not use** for architecture calls, reviewing Grok's own diff, or when the
user asked for Codex or Cursor.

## First-class native tools (prefer these over hand-rolled briefs)

| Tool | Job | Key inputs |
| --- | --- | --- |
| `grok_x_search` | Live X posts: date, URL, gist | `query` (operators or semantic), `from_user` (no `@`), `mode` Latest/Top, `window_days`, `limit` ≤ 10, `semantic`, `exclude_replies` |
| `grok_imagine` | Still image → saved path in `mediaPaths` | `prompt` (prose), `aspect_ratio`; `source_image` + `keep_from_source` to edit instead |
| `grok_video` | Animate one still → mp4 in `mediaPaths` | `source_image` (frame 1, absolute), `prompt` (one moment, one camera move), `duration` 6/10, `resolution` 480p/720p |

Why first-class: the X and Imagine tools are **not** on Grok's read-only
auto-approve list, so a `read-only` delegation can hang on a permission
prompt. These tools run with the approval flags Grok needs and pass
`--disable-web-search` on X queries so the model cannot fall back to a weak
web scrape. Hand-rolling `delegate_to_grok` with `sandbox: "read-only"` for X
search is the classic hang — use `grok_x_search`.

Limits that matter: 10 posts per X call (resume or narrow the window for
more). No text-to-video — stage frame 1 with `grok_imagine`, then animate with
`grok_video`. Imagine is for photos/illustrations/scenes, **not** charts,
labelled diagrams, or UI with real copy (build those in HTML/CSS).

Still use `delegate_to_grok` for: full thread fetch ("Fetch the full X thread
for post id <ID>"), open-web search/fetch, and ordinary repo work.

## Always: health, then the call

1. Call `occ_health`. Grok must be `available` **and** `authenticated`.
2. Call the tool. For `delegate_to_grok`, write a brief Grok can run
   **without this chat**: goal, constraints (files), definition of done,
   non-goals. Never dump the chat.
3. Review `status`, `output`, `filesChanged` / `mediaPaths`, `error`.

## Pick a model

Headless flag: `-m`. Omit for the CLI default. **Call `occ_models`** for the
live catalog — local aliases (`dsv4-*`, `glm-5-2`, `minimax-m3`, …) appear
there when configured.

| `model` | Use for |
| --- | --- |
| omit / `grok-4.6` | Frontier Grok. Prefer this. |
| `grok-4.5` | Previous gen |
| local aliases | Only if `occ_models` lists them. Extraction / cheap bulk — not frontier reasoning. |

**Do not pass:** Codex slugs (`gpt-5.6-luna` / terra / sol) or Cursor slugs
(`auto`, `gpt-5`, `sonnet-4-thinking`).

## Pick reasoning effort

Maps to `grok --effort`. Omit → Grok default. `low` tight/obvious · `medium`
everyday · `high` multi-step · `xhigh` extra-high · `max` hardest single task.

## Other delegate_to_grok fields

|| Field | Notes |
|| --- | --- |
|| `cwd` | Absolute path of the **target repo**. Pass it. |
|| `sandbox` | grok 1.0.5 OS `--sandbox` hangs headless, so OCC never passes it. `read-only` omits `--always-approve` (safe for pure Q&A; can hang on X/Imagine tool approval — use the first-class tools). `workspace-write` / `danger-full-access` pass `--always-approve`. Always `--no-leader`, always `--verbatim`. |
|| `resume_session_id` | Prior result `sessionId` |
|| `timeout_ms` | Default 600000, max 1800000. Raise for video. |

You do not spawn `grok` yourself.

## Worked calls

X search (first-class):

```json
{
  "query": "Claude OR \"Claude Code\"",
  "from_user": "AnthropicAI",
  "mode": "Latest",
  "window_days": 7,
  "limit": 10,
  "exclude_replies": true
}
```

Imagine, then animate:

```json
{ "prompt": "A paper boat on dark water, soft studio light, cinematic.", "aspect_ratio": "16:9", "cwd": "/tmp/occ-media" }
```

```json
{ "source_image": "/tmp/occ-media/images/1.jpg", "prompt": "Slow push-in, slight ripple.", "duration": 6, "resolution": "480p", "cwd": "/tmp/occ-media" }
```

General delegate (web research):

```json
{
  "brief": "Search the web for the current stable Node.js LTS version and fetch the official release page. Reply with the version and URL only. Do not edit files.",
  "cwd": "/Users/roo/Developer/a8-agent-client-protocol/a8-orbital-command-centre",
  "sandbox": "read-only"
}
```

## After the tool returns

- `succeeded` — review `output`; media tools: check `mediaPaths` exists on disk
- `not_authenticated` / not logged in — `grok login`
- `timeout` — tighter brief or higher `timeout_ms`
- Empty `filesChanged` on an implement brief — re-brief with explicit file paths

## Decision cheat sheet

```
Live X posts?                   → grok_x_search (never "web search" in a brief)
Full X thread by id?            → delegate_to_grok
Image / video?                  → grok_imagine then grok_video
Open web page?                  → delegate_to_grok, name web_search/web_fetch
Repo implement?                 → delegate_to_grok + workspace-write
Continue same Grok thread?      → resume_session_id
```

## Red flags

- Passing `gpt-5.6-luna` because Codex uses it
- Spawning `agent` or `grok agent stdio` when the MCP tool exists
- Saying "web search" when you want live X posts
- `sandbox: "read-only"` for X search or Imagine — hangs on tool approval
- Expecting text-to-video — stage a still first
- Asking Imagine for 4 variants in one call — one call per image
- Dumping the conversation into `brief`

## Common mistakes

|| Excuse | Reality |
|| --- | --- |
|| "`agent` is Cursor" | `agent` is Grok when `~/.grok/bin` is on PATH. Cursor is `cursor-agent`. |
|| "I'll copy Codex model slugs" | Different catalog. Grok wants `grok-4.6` / `grok-4.5`. |
|| "50 posts in one call" | X tools cap at 10 per call. Resume or narrow the window. |
|| "Grok already has the repo" | It has `cwd` + the brief. Nothing else. |

Recipes: `docs/source-refs/grok-p-web-search.md`, `grok-p-x-search.md`,
`grok-p-imagine.md`.
