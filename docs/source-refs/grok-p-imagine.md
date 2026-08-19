# grok -p + Imagine (image / video)

Captured: 2026-08-19.
Applies to Grok Build CLI headless mode on this machine. General headless/ACP flags: [grok-build.md](./grok-build.md). Official CLI: `~/.grok/docs/user-guide/14-headless-mode.md`. Config: `~/.grok/docs/user-guide/05-configuration.md`. Skill (prompt-craft, consistency, real-people rules): `~/.grok/bundled/skills/imagine/SKILL.md`.

TUI shortcuts: `/imagine <description>` (still image) and `/imagine-video <description>` (plans shots, generates frames, animates). This page is the **headless** contract — the same tools, driven from `grok -p`.

X posts: [grok-p-x-search.md](./grok-p-x-search.md). Open web: [grok-p-web-search.md](./grok-p-web-search.md).

## What each tool does

There is **no text-to-video**. Video starts from an image.

| Tool | Job | You need a source image? |
|------|-----|--------------------------|
| `image_gen` | New still from a prompt | No |
| `image_edit` | Transform / restyle / preserve likeness from source(s) | Yes (1+ paths, HTTPS, or `data:image/…;base64,…`) |
| `image_to_video` | Animate **one** image as frame 1 | Yes. Default path. |
| `reference_to_video` | Video from up to 7 image refs and/or up to 3 preset voices. Does **not** lock frame 1 | At least one of `images` or `voices` |

Rule of thumb: **no source → `image_gen`. Source → `image_edit`. Animate a staged frame → `image_to_video`.** Use `reference_to_video` only when the brief needs multiple refs or a speaking voice, or when asked by name.

These tools are **not** on the read-only auto-approve list. `grok -p` scripts need `--always-approve` (alias `--yolo`) or they hang on a permission prompt.

Permission `--allow` / `--deny` prefixes do **not** include Imagine (`WebSearch` / `WebFetch` / `Bash` / … only). Gate with `--tools` / `--disallowed-tools`, not `--deny Image`.

Do **not** use Imagine for charts, labelled diagrams, math, tables, UI with real copy, or multi-panel grids that must be exact. Build those in HTML/CSS (or similar). Imagine is for photos, illustrations, characters, scenes.

## Canonical commands

Still, from scratch:

```bash
grok -p "Generate a 16:9 cinematic still: a rain-soaked neon alley at night, single figure under a red sign, wet asphalt reflections, anamorphic bokeh. Use image_gen. Print the saved path." \
  --always-approve
```

Edit an existing file (absolute path in the brief):

```bash
grok -p "Edit /Users/roo/Pictures/hero.png with image_edit: keep the subject and composition, switch to overcast daylight, cooler grade. Print the saved path." \
  --always-approve
```

Image then 6s video (usual two-step):

```bash
grok -p "1) image_gen a 16:9 still of a paper boat on dark water, soft studio light. 2) image_to_video that file as frame 1, 6s, 720p, slow push-in with a slight ripple. Print both saved paths." \
  --always-approve
```

TUI equivalent (not headless):

```
/imagine a golden sunset over a calm ocean with silhouetted palm trees
/imagine-video a cat playing piano in a jazz club
```

## Prompt recipe

The CLI does not take Imagine arguments as flags. They go in the English brief. The model fills the tool schema.

**Image brief — include**

1. Name the tool (`image_gen` or `image_edit`).
2. Subject → pose/action → setting → style → composition → lighting/mood → key details. Natural prose, 2–5 sentences. Say what to include, not what to exclude. No keyword-tag salad.
3. `aspect_ratio` for new images (`16:9` banner/video frame, `9:16` story, `1:1` icon).
4. For edits: the **absolute path** (or HTTPS / data URL) and **what must stay the same**.
5. “Print the saved path.” Scripts cannot guess it.

**Video brief — include**

1. There is no text-to-video. Stage frame 1 first, then `image_to_video`.
2. One short present-tense moment, one camera move, 1–2 sentences. Not a montage in a single shot.
3. Duration `6` (prefer) or `10`. Resolution `480p` (default) or `720p`.
4. Recurring character: generate one canonical still, then `image_edit` / `image_to_video` from that file. Fresh `image_gen` per shot drifts.

`--verbatim` if the visual prompt is already finished and must not be rewritten.

```text
# still
Use image_gen, aspect_ratio 1:1. A ceramic mug of black coffee on oak, window light from the left, shallow depth of field. Print the saved path.

# edit
Use image_edit on /abs/path/to/ref.jpg. Keep the face and wardrobe. Place the subject on a foggy pier at dawn. Print the saved path.

# video from a still you already have
Use image_to_video on /abs/path/to/frame.jpg. 6 seconds, 720p. Slow orbit left, coat hem moving in wind. Print the saved path.
```

## Tool parameters

You cannot pass these as `grok` flags. Put the values in the brief.

### `image_gen`

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `prompt` | string | — | required |
| `aspect_ratio` | string | `auto` | `1:1` square, `16:9` wide, `9:16` tall, `3:2` horizontal photo, `2:3` vertical |

No `n` / `count`. Multiple variants = multiple calls with distinct prompts.

Returns a saved file. Tell the user the **session-relative** path (`images/1.jpg`); the tool also yields an absolute path.

### `image_edit`

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `prompt` | string | — | required. Describe the change; say what stays |
| `image` | string[] | — | required. Each entry: absolute path, HTTPS URL, or `data:image/…;base64,…`. One clean ref is more reliable than many |
| `aspect_ratio` | string | `auto` (multi-image only) | **Ignored for single-image edits** — output matches the input ratio. Multi-image: `1:1`, `16:9`, `9:16`, `4:3`, `3:4`, `3:2`, `2:3`, `2:1`, `1:2`, `19.5:9`, `9:19.5`, `20:9`, `9:20`, `auto` |

User-attachment tokens like `[Image #1]` exist in the TUI. On the CLI, pass a filesystem path (or data URL) in the brief instead.

### `image_to_video`

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `image` | string | — | required. Absolute path, HTTPS, or data URL. Becomes **frame 1** |
| `prompt` | string | optional | Camera + motion. Omit for a generic animation |
| `duration` | int | 6 | **6 or 10 only** |
| `resolution_name` | string | `480p` | `480p` or `720p`. Only raise when the brief asks |

Aspect ratio is inherited from the **source image**. Set it on `image_gen`; do not re-crop the video.

Session-relative output: `videos/1.mp4`.

### `reference_to_video`

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `prompt` | string | — | required. Tag refs as `<IMAGE_0>`, `<IMAGE_1>`, … and `<AUDIO_0>`, … |
| `aspect_ratio` | string | — | **required**. Same family as image_gen (`1:1`, `16:9`, `9:16`, `4:3`, `3:2`, `3:4`, `2:3`, …) |
| `images` | string[] | [] | Up to **7**. Path / HTTPS / data URL |
| `voices` | string[] | [] | Up to **3** preset IDs (examples: `ara`, `eve`, `leo`, `rex`). Unknown ID fails with the live roster |
| `duration` | int | 6 | **1–15** seconds (unlike `image_to_video`) |
| `resolution_name` | string | `480p` | `480p` or `720p` |

Need at least one image or one voice. Prefer composing refs with multi-image `image_edit` and then `image_to_video`, unless the shot needs a speaking voice or unlocked frame 1.

## CLI flags that matter

| Flag | Effect |
|------|--------|
| `-p, --single <PROMPT>` | One shot; stdout; exit |
| `--always-approve` / `--yolo` | Required — Imagine is not auto-approved |
| `--tools image_gen,image_edit,image_to_video,reference_to_video` | Allowlist (headless). MCP meta-tools still remain |
| `--disallowed-tools image_to_video,reference_to_video` | Stills only |
| `--verbatim` | Do not rewrite a finished visual prompt |
| `--max-turns <N>` | Cap the gen → edit → animate loop. Video needs more than 1 |
| `--output-format json` | Parse `.text` for the printed paths |
| `--prompt-file <PATH>` | Long brief; stdin is **not** the prompt |
| `-c` / `-r <id>` | Continue / resume (animate a still from the previous call) |
| `--cwd <PATH>` | Working directory (where session-relative `images/` / `videos/` resolve) |
| `--no-auto-update` | Scripts / CI |

Internal tool IDs for `--tools` / `--disallowed-tools` are the snake_case names above. They are **not** valid `--allow` / `--deny` prefixes.

Interactive TUI has `/imagine` and `/imagine-video`. Those flags are not CLI commands; use `grok -p` with the brief.

## Config and environment

`~/.grok/config.toml`, read at session start:

```toml
# [tools.media_gen]
# max_parallel_image_gen_calls = 8   # default 8
# max_parallel_video_gen_calls = 4   # default 4
```

First burst at or above 2× the cap: that step is discarded and retried once. Any other over-cap (including a second 2× burst) keeps the first K.

| Env | Effect |
|-----|--------|
| `GROK_MAX_PARALLEL_IMAGE_GEN_CALLS` | Override image parallel cap |
| `GROK_MAX_PARALLEL_VIDEO_GEN_CALLS` | Override video parallel cap |

Inference `extra_headers` on `[models]` / `[model.*]` do **not** ride on image or video generation.

## Shot pipeline (video)

1. Plan beats. Prefer several **6s** shots over one long take.
2. Canonical still per recurring subject (`image_gen` once).
3. Each shot’s frame 1 via `image_edit` from that still (not a fresh `image_gen`).
4. `image_to_video` each frame. One subject, one motion.
5. Continuity: extract the last frame with ffmpeg, use it as the next shot’s source.
6. Concat with stream copy (same resolution and frame rate on every shot):

```bash
ffmpeg -f concat -safe 0 -i shots.txt -c copy out.mp4
```

Busy source images warp. Keep the subject still and move only the camera, or generate a simpler frame 1.

Moderation block: stop. Do not paraphrase to evade. Say it was blocked.

Named real people: `image_edit` / video from a real reference after a web search. Never pure `image_gen`. No non-consensual, sexualized, or minor-involving likenesses.

## Scripting

```bash
# Still, json out
grok -p "image_gen, 1:1, ceramic mug on oak, window light. Print only the saved absolute path." \
  --always-approve --output-format json --no-auto-update \
  | jq -r '.text'

# Two calls: generate, then animate
SID=$(grok -p "image_gen 16:9 paper boat on dark water. Print the absolute path." \
  --always-approve --output-format json | jq -r '.sessionId')
grok -p "image_to_video that still, 6s, 720p, slow push-in. Print the mp4 path." \
  --resume "$SID" --always-approve

# Stills only
grok -p "Three distinct 1:1 icon variations of a fox mask, separate image_gen calls. Print all paths." \
  --disallowed-tools "image_to_video,reference_to_video" --always-approve
```

Ask the model to print **absolute** paths. Session-relative `images/1.jpg` is for humans in the TUI.

`--max-turns` for a gen+animate run should be more than 2 (tool calls + the final answer).

## Common mistakes

- **Expecting text-to-video** — does not exist. Stage a still, then `image_to_video`.
- **Omitting `--always-approve`** — hangs.
- **`--deny Image`** — not a recognised permission prefix. Use `--disallowed-tools image_gen`.
- **`duration: 8` on `image_to_video`** — only 6 or 10. (`reference_to_video` is 1–15.)
- **Setting aspect ratio on the video tool** — set it on `image_gen`. `image_to_video` inherits the still.
- **`n=4` for variants** — no such param. Four calls, four prompts.
- **Animating a labelled diagram / UI mock** — garbles. Build in code.
- **Fresh `image_gen` per shot of the same character** — identity drifts. Anchor to one still.
- **Piping the brief on stdin** — ignored. Use `-p` or `--prompt-file`.
- **Passing a relative path to `image_edit`** — use an absolute path.

## Relation to Orbital

When a Grok adapter lands under `packages/adapters/grok/`, Imagine is a headless side-effect: spawn `grok -p --always-approve`, put the visual brief (and any source **absolute** paths) in the prompt, raise `--max-turns` for video, parse printed paths out of `--output-format json`. Do not treat `/imagine` as a CLI subcommand.

ACP path: `grok agent stdio` — see [grok-build.md](./grok-build.md).
