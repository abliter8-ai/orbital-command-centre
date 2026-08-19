# agy -p — headless / print mode

Captured: 2026-08-19.
Official: [Headless mode](https://antigravity.google/docs/cli/headless). Cross-checked against `agy --help` and changelog **1.1.15** on this machine (`/Users/roo/.local/bin/agy`).

Headless mode is also called **print mode**. It sends a prompt to the agent, prints the response, and exits. There is no TUI and no interactive permission card.

## Canonical command

```bash
agy -p "In one sentence, what is a git rebase?"
```

Aliases of `-p`: `--print`, `--prompt`. All three are the same flag.

- **stdout** = the model response (or JSON / NDJSON)
- **stderr** = diagnostics (errors, auth, progress, permission notices)

```bash
# Capture the answer; diagnostics still hit the terminal.
answer=$(agy -p "Name three popular version control systems, comma-separated.")
```

Workspace is **the current working directory**. There is **no `--cwd` flag** in `agy --help` (1.1.15). The best-practices page still shows `agy -p "…" --cwd $(pwd)` — that is stale. `cd` first, or spawn with that directory as cwd.

## Auth (must be done before CI)

Headless uses **cached credentials**. Authenticate once with an interactive `agy` session.

In a non-interactive environment with no TTY, an unauthenticated run exits with `authentication required` instead of hanging.

CI / no-browser path ([install](https://antigravity.google/docs/cli/install)):

1. `~/.gemini/antigravity-cli/settings.json` must contain `"modelProvider": "gemini"` (**required** — `GEMINI_API_KEY` alone does nothing).
2. `export GEMINI_API_KEY=…` (environment only; `.env` files and `GOOGLE_API_KEY` are ignored).
3. Optional custom endpoint: `GOOGLE_GEMINI_BASE_URL`.
4. If `modelProvider` is `gemini` and the key is unset, the CLI **refuses to start**. `/logout` is a no-op under API-key auth.

## Output formats

`--output-format` (`text` default, `json`, `stream-json`).

### `text`

Raw response on stdout. Default.

### `json`

One JSON object on completion, one line. Pipe through `jq`.

```bash
agy -p "In one sentence, what is a git rebase?" --output-format json | jq
```

Envelope:

| Field | Type | When |
|-------|------|------|
| `conversation_id` | string | Always (empty string on some ERROR exits) |
| `status` | string | See [Status](#status-and-exit-codes) |
| `response` | string | Free-text answer |
| `error` | string | Failures only |
| `duration_seconds` | number | Wall clock |
| `num_turns` | number | User turns |
| `usage` | object | `input_tokens`, `output_tokens`, `thinking_tokens`, `cache_read_tokens`, `total_tokens` |
| `structured_output` | object | Only with `--json-schema` |
| `json_schema` | object | Only with `--json-schema` |

### `--json-schema`

Constrains the answer. Accepts a JSON schema **string**, a **path** to a `.json` file, or a primitive type name (`string`, `number`, `integer`, `boolean`).

Parsed value is `structured_output`. `response` is the same payload as a JSON string.

```bash
agy -p "Parse v2.14.3 into major, minor, patch integers." \
  --output-format json \
  --json-schema '{"type":"object","properties":{"major":{"type":"integer"},"minor":{"type":"integer"},"patch":{"type":"integer"}},"required":["major","minor","patch"]}' \
  | jq '.structured_output'
```

With `--output-format stream-json`, the schema applies only to the terminal `result` event.

### `stream-json`

NDJSON on stdout. One `init`, then `step_update`s, then exactly one `result` (same shape as the `json` envelope).

| `event` | Payload | When |
|---------|---------|------|
| `init` | `init` | Once at start |
| `step_update` | `step_update` | Each step / text delta |
| `result` | `result` | Once at end |

`init` fields: `cwd`, `tools[]`, `permission_mode` (`request-review` default; `always-proceed` under `--dangerously-skip-permissions`). `model` / `agent` / `json_schema` only when those flags are set.

`step_update` fields: `conversation_id`, `step_index`, `state` (`ACTIVE` \| `DONE`), `step_type` (`user_input`, `agent_response`, `tool`, `checkpoint`), optional `tool_name`, `text_delta`, `duration_seconds`, `usage`, `tool_info`, `subagent_info`.

Long answers emit several `ACTIVE` `agent_response` events with `text_delta` fragments, then `DONE`. Concatenate with `jq -j` so jq does not insert newlines:

```bash
agy -p "Explain merge conflicts in two sentences." --output-format stream-json \
  | jq -j 'select(.event=="step_update") | .step_update.text_delta // empty'
```

Tool step example (`tool_info`): `name`, `parameters`, `output`, and on failure `error.{type,message}`. Subagent steps use `subagent_info.subagents[]` (`type_name`, `role`, `conversation_id`, `log_uri`, `workspace_uris`).

```bash
agy -p "In one sentence, what is a git rebase?" --output-format stream-json \
  | jq 'select(.event=="result") | .result.usage'
```

## Input formats (print mode)

`--input-format` (default `text`). From `agy --help` / changelog **1.1.15** (the headless docs page as fetched still only describes output streaming):

| Value | Behaviour |
|-------|-----------|
| `text` | Prompt comes from `-p "…"` |
| `stream-json` | Read **NDJSON from stdin**, one turn per message, **same conversation**. **Requires** `--output-format stream-json` |

Use this to keep a session open from a driver process. The official page does not yet publish the stdin message schema; treat changelog + `--help` as the contract until it does.

## Continue a conversation

Print runs are **stateless by default**. Resume with:

```bash
# Most recent conversation for this workspace
agy -p "Now explain that in more detail" --continue    # alias: -c

# Explicit ID from a previous json envelope
agy -p "Summarize what we discussed" --conversation 055a398f-db14-4c5f-abbb-1bf03f8120a7
```

`-c` lookup file: `~/.gemini/antigravity-cli/cache/last_conversations.json` — map of **absolute workspace path → conversation ID**. Missing or deleted ID → fresh session.

Conversations are **cwd-scoped**. Launch from the same directory you used before.

`--project <id>` / `--new-project` attach the session to an Antigravity project. Resuming a conversation adopts that conversation’s project automatically.

## Model, effort, agent, mode

```bash
agy models          # live slugs
agy agents          # custom / built-in agents

agy -p "Reverse the string antigravity." --model gemini-3.5-flash-medium
agy -p "Outline a caching plan." --effort high          # low | medium | high
agy -p "Review this function for edge cases." --agent <name>
agy -p "Implement the change." --mode accept-edits      # accept-edits | plan
```

Unknown `--model` in headless: **no silent fallback**. Non-zero exit, `status: ERROR`. Pipelines fail loudly.

`--mode` is the **execution** mode ([modes](https://antigravity.google/docs/cli/modes)), not a permission skip:

| Mode | File writes | Planning |
|------|-------------|----------|
| `default` (omit `--mode`) | Would pause for review — in print mode that becomes a **soft-deny** unless auto-allowed | — |
| `accept-edits` | Auto-approves file create/write (`write_to_file`, `replace_file_content`, …). Subagents inherit it | — |
| `plan` | Prepends `/plan`. Read-only investigate, then outline | Does not by itself skip shell permission |

`--permission-mode` is **not** an `agy` flag (Gemini CLI leftover). Shell `run_command` is still governed by [permissions](#permissions-in-print-mode) in every mode.

`--add-dir <path>` (repeatable) adds extra directories to the workspace.

## Permissions in print mode

There is **no y/n card**. Tools that would Ask are **soft-denied**: the run **continues, exits 0**, and prints a notice on **stderr** naming the tool and how to allow it.

Default:

- Read/write **inside the active workspace** — auto-allowed
- `command`, `read_url`, `execute_url`, `mcp`, non-workspace files — **Ask** → **soft-deny** in headless

That means `agy -p "Run the tests"` can print a plausible answer, exit 0, and **never have run the tests**. Check stderr. Prefer `--output-format json` and scoped allow-rules.

Grant ahead of time in `~/.gemini/antigravity-cli/settings.json`:

```json
{
  "permissions": {
    "allow": [
      "command(git)",
      "command(npm run (build|lint|test))",
      "write_file(src/)"
    ],
    "deny": [
      "command(rm -rf)",
      "command(sudo)"
    ]
  }
}
```

Rule language (`action(target)`), Deny > Ask > Allow: [Permissions](https://antigravity.google/docs/cli/permissions).

| Action | Target | Notes |
|--------|--------|-------|
| `read_file` / `write_file` | path, dir, or `*` | `write_file` implies read on the same path. Deny-read implies deny-write |
| `command` | prefix or per-token regex | `command(npm run (build\|lint\|test))` |
| `unsandboxed` | command prefix | Escape hatch when terminal sandbox is on |
| `read_url` / `execute_url` | hostname (`google.com` covers subdomains) | Default Ask |
| `mcp` | `server/tool` or `server/*` or `*` | |

Nuke-switch for one run:

```bash
agy -p "Run the test suite and report failures" --dangerously-skip-permissions
```

That auto-approves **all** tools (writes **and** shell). Prefer scoped `permissions.allow` unless the prompt and machine are fully trusted.

`--sandbox` enables OS containment for the run (`sandbox-exec` on macOS, `nsjail` on Linux, `AppContainer` on Windows). Persistent: `"enableTerminalSandbox": true`.

`--disable-slash-commands` — do not expand `/skills` or slash commands in the print prompt.

## Status and exit codes

Success → exit `0`. Failure to produce a response → non-zero, reason on stderr. `json` / `stream-json` also set `status` / `error`.

| `status` | Meaning |
|----------|---------|
| `SUCCESS` | Produced a response |
| `ERROR` | Error (unknown model, auth, …) |
| `CANCELED` | Canceled |
| `INTERRUPTED` | e.g. SIGINT |
| `INVALID` | Invalid state |
| `WAITING` | Ended while waiting on input |
| `RUNNING` | Did not reach a terminal state |

Default wait: **5 minutes**. Raise it:

```bash
agy -p "Summarize the design tradeoffs of optimistic locking." --print-timeout 15m
```

Unknown model example: exit `1`, `status: ERROR`, empty `conversation_id`.

## Full print-mode flag set

From `agy --help` (1.1.15). Official headless table is a subset; extras below are live on this binary.

| Flag | Default | Print-mode role |
|------|---------|-----------------|
| `-p`, `--print`, `--prompt` | — | Enter print mode with this prompt |
| `--output-format` | `text` | `text` \| `json` \| `stream-json` |
| `--input-format` | `text` | `text` \| `stream-json` (stdin NDJSON; requires stream-json output) |
| `--json-schema` | — | Schema string, file path, or primitive type |
| `--print-timeout` | `5m` | Max wait |
| `--model` | — | Slug from `agy models`. Unknown → ERROR |
| `--effort` | — | `low` \| `medium` \| `high` |
| `--agent` | — | From `agy agents` |
| `--mode` | settings / default | `accept-edits` \| `plan` |
| `--continue`, `-c` | false | Resume last conversation for this cwd |
| `--conversation <id>` | — | Resume by ID |
| `--project <id>` | `default-cli-project` | Attach to a project |
| `--new-project` | false | Create a project for this session |
| `--add-dir <path>` | [] | Extra workspace roots (repeatable) |
| `--dangerously-skip-permissions` | false | Auto-approve every tool |
| `--sandbox` | false | Terminal sandbox on |
| `--disable-slash-commands` | false | No skill/slash expansion |
| `--log-file <path>` | — | Override log path |
| `-i`, `--prompt-interactive` | — | **Not** print mode: initial prompt, then stay in the TUI |

## Models on this machine (2026-08-19)

From `agy models` (list will move):

```
gemini-3.7-flash-high | medium | low
gemini-3.6-flash-high | medium | low
gemini-3.5-flash-high | medium | low
gemini-3.1-pro-high | low
claude-sonnet-4-6
claude-opus-4-6-thinking
gpt-oss-120b-medium
```

## Scripting

```bash
#!/usr/bin/env bash
set -euo pipefail

result=$(agy -p "Review the staged diff and draft a conventional commit message." \
  --mode accept-edits \
  --output-format json \
  --print-timeout 10m)

status=$(echo "$result" | jq -r '.status')
if [[ "$status" != "SUCCESS" ]]; then
  echo "Agent run failed: $(echo "$result" | jq -r '.error')" >&2
  exit 1
fi

echo "$result" | jq -r '.response'
```

Two-turn session:

```bash
ID=$(agy -p "List the public AgentHandle methods in this repo." \
  --output-format json --print-timeout 10m | jq -r '.conversation_id')
agy -p "Now draft a one-paragraph MCP façade description from that." \
  --conversation "$ID" --output-format json
```

Watch stderr even on SUCCESS — that is where soft-denies land.

## Common mistakes

- **`--cwd`** — not a flag. `cd` into the repo.
- **Expecting tests to run without allow-rules** — `command(*)` defaults to Ask → soft-deny, **exit 0**. Check stderr or pass `--dangerously-skip-permissions`.
- **`--mode accept-edits` vs `--dangerously-skip-permissions`** — first auto-approves **files**; second auto-approves **everything including shell**.
- **`--permission-mode`** — Gemini CLI flag. `agy` uses `--mode` plus `permissions.*` in settings.
- **`GEMINI_API_KEY` without `modelProvider: "gemini"`** — ignored.
- **Unknown `--model`** — hard fail in print mode (good). Do not assume TUI fallback behaviour.
- **Default 5m timeout** — long agent loops need `--print-timeout`.
- **Resuming from the wrong directory** — last-conversation cache is keyed by absolute cwd.
- **Best-practices `agy -p … --cwd $(pwd)`** — copy-paste from a stale page; drop `--cwd`.
- **Treating `-i` as headless** — `-i` stays interactive.

## Relation to Orbital

When an Antigravity adapter lands under `packages/adapters/`, print mode is the spawn contract: `agy -p <prompt> --output-format json`, cwd = workspace, `--print-timeout` well above 5m for real tasks, `--mode accept-edits` if you want writes, explicit `permissions.allow` or `--dangerously-skip-permissions` if you want shell, parse `.status` / `.response` / `.conversation_id`. Do not wait on a TUI permission card. Soft-deny + exit 0 is the failure mode to test for.

TUI / ACP-style interactive: plain `agy`, not `-p`.
