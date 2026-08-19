**Detailed Guide: Web Search, Browser Automation, and URL Actions in Antigravity CLI (`agy`) — with Focus on Non-Interactive Mode (`agy -p`)**

Antigravity CLI (`agy`) shares its agent harness with Antigravity 2.0. This means the same core tools for web interaction are available in both the interactive TUI and the non-interactive “print” / headless mode invoked with `agy -p` (aliases: `--print`, `--prompt`).  

The key differences appear in **permissions handling** and **how you enable or observe** the tools, because `-p` mode has no interactive approval prompts.

### 1. Web Searches (Especially via Subagents)

Official documentation states that **subagents have full access** to tools including code search, file editing, terminal commands, **and web searches**.

- Related Antigravity / Gemini agent surfaces expose:
  - `google_search` — public web search (grounded search).
  - Supporting tools such as `url_context` / `read_url` for fetching page content.
- These surface in CLI sessions through the shared harness, model grounding (especially with Gemini models), or explicit subagent delegation.
- The main agent can spawn subagents for parallel research; those subagents inherit or are granted the web-search capability.

**In interactive mode**  
The agent (or a subagent) simply decides to search when the task requires current information. You may see tool steps for search in the TUI.

**In `agy -p` (non-interactive) mode**  
- Web search is available if the model/harness exposes it and permissions allow it.
- Because there is no interactive prompt, any tool that defaults to “Ask” will be **soft-denied** unless you pre-authorize it.
- Soft-deny behavior: the run continues, exits with code 0, and a notice appears on **stderr** naming the denied tool and how to allow it.
- To make web search reliable in scripts/CI:
  1. Pre-allow the relevant actions in `~/.gemini/antigravity-cli/settings.json`, or
  2. Use `--dangerously-skip-permissions` (see section 5).

Subagents can still be spawned in `-p` mode. Their activity appears in `--output-format stream-json` under `subagent_info`.

### 2. Browser Automation (Opt-in via `/browser`)

- Enabled in interactive sessions with the slash command `/browser`.
- Once enabled, the agent can drive a live browser: navigate, interact with the DOM (click, type, etc.), and read rendered content.
- Useful for UI verification, reproducing client-side bugs, OAuth flows, or any task where static HTTP fetches are insufficient.
- First use requires approval; thereafter it stays enabled for the session.
- Security: runs in an isolated Chrome profile; controlled by allow/deny lists.

**In `agy -p` mode**  
You cannot type `/browser` mid-run. Browser tools become available only if:
- The underlying browser capability is enabled in settings, **and**
- Permissions for `execute_url` (and related actions) are pre-allowed, **or**
- You pass `--dangerously-skip-permissions`.

In practice, for pure headless runs that need browser automation, many users either:
- Pre-configure permissions broadly, or
- Prefer the lighter `read_url` tool when full interactivity is not required.

### 3. URL-Related Actions (`read_url` / `execute_url`)

These appear explicitly in the permissions model:

| Action          | Target Format                  | Matching Behavior                                      | Default |
|-----------------|--------------------------------|--------------------------------------------------------|---------|
| `read_url`      | `read_url(domain)` or `read_url(*)` | Matches hostname + subdomains (paths ignored)         | **Ask** |
| `execute_url`   | `execute_url(domain)` or `execute_url(*)` | Same domain matching; used for interactive browser actions | **Ask** |

- `read_url` — Fetch and process page content (closer to a grounded fetch / `url_context`).
- `execute_url` — Actuate on the page (click, type, drive interactive workflows). Closely tied to full browser automation.

**Defaults**  
Web browsing actions default to **Ask**. The agent pauses for approval in interactive mode unless an `allow` rule exists.

**In `agy -p`**  
Same soft-deny behavior applies. Without an explicit allow rule or `--dangerously-skip-permissions`, the agent cannot fetch external URLs or drive the browser.

### 4. Permissions Configuration (Critical for `-p`)

Permissions live in:
```json
~/.gemini/antigravity-cli/settings.json
```

Relevant structure:
```json
{
  "permissions": {
    "allow": [
      "read_url(google.com)",
      "read_url(*)",
      "execute_url(example.com)",
      "command(git)",
      // other rules...
    ],
    "deny": [
      // ...
    ],
    "ask": [
      // ...
    ]
  }
}
```

- **Workspace file read/write** is auto-allowed even in headless mode.
- Shell commands, `read_url`, `execute_url`, MCP tools, etc., default to Ask → soft-denied in `-p` unless listed under `allow`.
- You can manage rules interactively in the TUI with `/permissions`, then reuse the same config for headless runs.

**Recommended safe pattern for research-oriented `-p` runs**:
```json
"allow": [
  "read_url(*)",
  "command(git status)",
  "command(git log)",
  // narrowly scoped shell if needed
]
```

For fully unattended runs that may need any tool (including writes and browser):
```bash
agy -p "your prompt" --dangerously-skip-permissions
```
**Warning**: This auto-approves *everything* (file writes, arbitrary shell, full web access). Use only in trusted/sandboxed environments.

### 5. Practical Usage with `agy -p`

#### Basic web-research example
```bash
# Soft-deny likely if no allow rules exist
agy -p "Search for the latest Antigravity CLI release notes and summarize the top three changes."

# Reliable version
agy -p "Search for the latest Antigravity CLI release notes and summarize the top three changes." \
  --dangerously-skip-permissions
```

#### Observing tool calls (highly recommended)
```bash
agy -p "Research X and fetch the official docs page" \
  --output-format stream-json \
  --dangerously-skip-permissions
```
Look for `step_update` events with `"step_type": "tool"` and `tool_info` containing names such as search-related tools, `read_url`, etc. Subagent activity appears under `subagent_info`.

#### Structured output + timeout
```bash
agy -p "Find the current stable version of package Y and return only the version string." \
  --output-format json \
  --json-schema string \
  --print-timeout 10m \
  --dangerously-skip-permissions
```

#### Combining with model / agent selection
```bash
agy -p "..." --model "Gemini 3.1 Pro" --agent some-custom-agent --dangerously-skip-permissions
```

#### Continuing a previous conversation
```bash
agy -p "Follow up on the previous research" --continue
# or
agy -p "..." --conversation <id-from-previous-run>
```

### 6. Limitations & Edge Cases Specific to `-p`

- **No mid-run slash commands** — You cannot issue `/browser` or `/mcp` during a `-p` run. Capabilities must be pre-enabled via settings or the dangerous flag.
- **Soft-denies are silent on stdout** — Always check stderr (or use `stream-json`) to see why a tool was blocked.
- **Timeouts** — Default is 5 minutes (`--print-timeout`). Long research + subagents can exceed this.
- **Authentication** — Must already be authenticated (cached credentials). Headless runs fail fast if not logged in.
- **Sandbox interaction** — `--sandbox` primarily affects terminal/shell tools. Combined with `--dangerously-skip-permissions` it has known edge cases (see community issues).
- **Subagent visibility** — Fully supported; watch `subagent_info` in stream-json.
- **Output gating** — Some environments have reported empty stdout when piping if the process is not attached to a real TTY; community bridges exist for pure headless embedding.

### 7. Best Practices for Web-Related Work in `-p`

1. Prefer `read_url` + model grounding / `google_search` for most research (lighter and safer than full browser).
2. Pre-configure narrow `read_url(domain)` rules for trusted documentation sites.
3. Use `--output-format stream-json` during development so you can see exactly which tools fire.
4. Reserve `--dangerously-skip-permissions` for disposable environments or tightly controlled CI jobs.
5. For complex multi-source research, let the main agent spawn subagents — they inherit web-search capability when permissions allow.
6. Combine with `--print-timeout` for anything involving network latency or multiple subagents.
7. Test the exact permission rules interactively first (`agy` TUI + `/permissions`), then reuse the settings file for scripts.

### Quick Reference Flags for Web Work in `-p`

| Flag                              | Purpose                                      | Notes |
|-----------------------------------|----------------------------------------------|-------|
| `-p` / `--print` / `--prompt`     | Non-interactive single-shot mode             | Required |
| `--dangerously-skip-permissions`  | Auto-approve all tools                       | Powerful but risky |
| `--output-format stream-json`     | See every tool call & subagent in real time  | Highly recommended |
| `--print-timeout <duration>`      | Override 5-minute default                    | e.g. `15m` |
| `--model`, `--agent`              | Pin model or custom agent                    | Optional |
| `--continue` / `--conversation`   | Resume prior context                         | Optional |

This combination of model-grounded search, explicit `read_url`/`execute_url` tools, opt-in browser automation, and subagent delegation gives `agy` solid web capabilities. In interactive sessions the experience is fluid; in `agy -p` it becomes fully scriptable once permissions (or the dangerous flag) are set correctly.

For the absolute latest behavior, always cross-check the official docs at `antigravity.google/docs/cli/headless` and `antigravity.google/docs/cli/permissions`, as the permission surface and tool names continue to evolve with the shared agent harness.