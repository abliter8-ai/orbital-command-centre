# grok -p + web_search / web_fetch

Captured: 2026-08-19.
Applies to Grok Build CLI headless mode on this machine. General headless/ACP flags: [grok-build.md](./grok-build.md). Official CLI: `~/.grok/docs/user-guide/14-headless-mode.md`. Config: `~/.grok/docs/user-guide/05-configuration.md`. Permissions: `~/.grok/docs/user-guide/22-permissions-and-safety.md`.

Live X posts are a different path — [grok-p-x-search.md](./grok-p-x-search.md). Do not use these tools for that.

## What each tool does

| | `web_search` | `web_fetch` |
|---|---|---|
| Job | Discover pages | Read one page |
| Input | Query string | URL |
| Output | Hit list `{type, url, title}` | Page body as markdown |
| Runs where | **Server-side** when the model has `supports_backend_search = true` (inline `server_tool_use`); otherwise a client fallback | **Client-side only.** There is no server `web_fetch` and no `web_fetch_requests` counter |
| Approval | Read-only. Auto-runs in every permission mode unless a `deny`/`ask` rule or hook blocks it | **Not** on the read-only list. Can prompt. Scripts need `--always-approve` (or an `--allow` rule) |
| Typical pair | Search first | Fetch the best hit |

`--disable-web-search` removes **both**. `GROK_WEB_FETCH=0` removes only fetch.

Sibling, not a substitute: `open_page` / `open_page_with_find` also pull URL text (optional start line / regex). Billing treats `open_page` as a non-search `WebSearch` action — it does **not** increment `web_search_requests`.

`web_fetch` fails on authenticated or private URLs (Google Docs, Confluence, Jira, private GitHub). HTTP is upgraded to HTTPS. Long pages are truncated.

## Canonical commands

Search only (no fetch, so it usually will not hang on a permission prompt):

```bash
grok -p "Search the web for the current Agent Client Protocol spec. Return the top 8 hits as title + URL. Do not fetch pages." \
  --always-approve
```

Fetch a known URL:

```bash
grok -p "Fetch https://agentclientprotocol.com/protocol/overview and summarise the session lifecycle. Cite section headings." \
  --always-approve
```

Search then fetch (the usual two-step):

```bash
grok -p "Search the web for 'Agent Client Protocol session/prompt'. Fetch the official docs hit (not a blog). Summarise the request/response shape and quote the key fields." \
  --always-approve
```

`--always-approve` (alias `--yolo`) is required once fetch is in play. Search alone is auto-approved; fetch is not.

## Prompt recipe

The CLI does not take search/fetch arguments as flags. They go in the English brief. The model then fills the tool schema.

**Search brief — include**

1. Say **search the web** (or name `web_search`).
2. A specific query, not a topic noun.
3. How many hits you want (the tool default is 10, max 30).
4. Whether to **stop at the hit list** or **fetch** the best URL.
5. Output shape (titles+URLs, JSON, a one-paragraph answer with citations).

**Fetch brief — include**

1. The **full URL**.
2. What to extract (do not say “read the page” with no goal).
3. That authenticated/private URLs will fail.

```text
# discovery only
Search the web for "ACP Agent Client Protocol initialize authenticate". Return 10 hits: title, URL. Do not fetch.

# known page
Fetch https://agentclientprotocol.com/protocol/overview. Extract the session lifecycle steps as a numbered list.

# two-step
Search the web for current xAI grok-code model card. Fetch the official docs.x.ai page, not a third-party recap. Quote the context window and tool-use notes.
```

`--verbatim` sends the brief unchanged. Use it when the query is already finished.

## Tool parameters

These are what the model sends. You cannot pass them as `grok` flags. Put the values in the prompt.

### `web_search`

| Param | Type | Default | Constraint | Meaning |
|-------|------|---------|------------|---------|
| `query` | string | — | required | Search query |
| `num_results` | integer | 10 | 1–30 | How many hits to return |

Optional per-call `allowed_domains` exists on the model side. It is **ignored** whenever `[toolset.web_search]` has `allowed_domains` or `excluded_domains` set in config — that policy is authoritative. The per-call allowlist only applies when config is unset.

Result shape (backend search): `{type, url, title}` hit array on `web_search_tool_result`. Failed backend search: `content.type = "web_search_tool_result_error"`, `error_code` is a fixed `"unavailable"` placeholder (not a backend code). Failed searches are not counted in `web_search_requests`.

### `web_fetch`

| Param | Type | Default | Constraint | Meaning |
|-------|------|---------|------------|---------|
| `url` | string | — | required | Page to retrieve. HTTP is upgraded to HTTPS |

No `start_line` on `web_fetch`. For a window into a long page, use `open_page` (`url`, optional `start_line`) or `open_page_with_find` (`url`, `pattern`, `max_matches`, `context_lines`).

## CLI flags that matter

| Flag | Effect |
|------|--------|
| `-p, --single <PROMPT>` | One shot; stdout; exit |
| `--always-approve` / `--yolo` | Do not block on `web_fetch` approval |
| `--disable-web-search` | Remove `web_search` **and** `web_fetch` |
| `--tools web_search,web_fetch` | Allowlist (headless only). MCP meta-tools still remain |
| `--disallowed-tools web_fetch` | Drop fetch, keep search (or the reverse) |
| `--allow 'WebFetch(domain:docs.x.ai)'` | Auto-approve fetches of that host + subdomains |
| `--deny 'WebFetch(*)'` | Block every fetch; search still works |
| `--deny 'WebSearch'` | Block search (bare prefix = all invocations) |
| `--verbatim` | Do not rewrite the brief |
| `--output-format json` | `{ text, stopReason, sessionId, usage, … }` |
| `--json-schema '<json>'` | Constrain the **model answer** (implies json format) |
| `--prompt-file <PATH>` | Long brief; stdin is **not** the prompt |
| `--max-turns <N>` | Cap the search→fetch loop |
| `--no-auto-update` | Scripts / CI |
| `-c` / `-r <id>` | Continue / resume (fetch after a search in a later call) |

`--tools` / `--disallowed-tools` use **internal IDs**: `web_search`, `web_fetch`. `--allow` / `--deny` use **permission names**: `WebSearch`, `WebFetch`. Do not mix the spellings.

`--disallowed-tools` **removes** the tool. `--deny` leaves it visible but rejects matching calls. When both `--tools` and `--disallowed-tools` are set, the denylist wins.

Allowlist both, nothing else:

```bash
grok -p "Search the web for ACP session/cancel and summarise from official docs." \
  --tools "web_search,web_fetch" --always-approve
```

Search only (no fetch capability at all):

```bash
grok -p "Search the web for ACP. Titles and URLs only." \
  --disallowed-tools "web_fetch" --always-approve
```

## Permission rules

`--allow` / `--deny` use `ToolPrefix(glob)`:

| Prefix | Matches |
|--------|---------|
| `WebSearch` / `WebSearch(*)` | Every `web_search` call |
| `WebFetch` / `WebFetch(*)` | Every `web_fetch` call |
| `WebFetch(domain:example.com)` | That host and every subdomain, case-insensitive, leading `www.` ignored. **No wildcards inside `domain:`** |
| `WebFetch(https://api.example.com/*)` | Glob against the full URL (no `domain:` prefix) |

```bash
# Fetch only official docs; search stays unbounded
grok -p "Search then fetch the official ACP overview." \
  --allow 'WebFetch(domain:agentclientprotocol.com)' \
  --deny 'WebFetch(*)' \
  --always-approve
```

Deny wins over allow. `--always-approve` still honours deny (and hooks).

Recognised permission tool names: `Bash`, `Read`, `Edit`/`Write`, `Grep`/`Glob`, `MCPTool`, `WebFetch`, `WebSearch`. A bare `*` matches every tool.

## Config and environment

`~/.grok/config.toml` is read at **session start**. Edits do not apply mid-run.

```toml
[models]
web_search = "grok-4.5"                # model used by the web_search tool (separate from the chat model)

[toolset.web_search]
# Constrain the search itself (not a post-filter). Max 5 allowlist entries.
# allowed_domains and excluded_domains are mutually exclusive; allowlist wins if both are set.
allowed_domains = ["docs.x.ai", "agentclientprotocol.com"]
# excluded_domains = ["reddit.com", "pinterest.com"]

[toolset.web_fetch]
# proxy_endpoint = "https://proxy.example.com"
# allowed_domains = ["docs.rs", "x.ai"]   # override the built-in fetch allowlist
allow_local = false                      # default: SSRF fail-closed
```

| Env | Effect |
|-----|--------|
| `GROK_WEB_SEARCH_MODEL` | Same as `[models] web_search` |
| `GROK_WEB_FETCH=0` | Disable the fetch tool only |
| `GROK_WEB_FETCH=1` | Enable fetch |
| `GROK_WEB_FETCH_ALLOW_LOCAL=1` | Fetch **explicit** loopback only (`localhost` / `127.0.0.0/8` / `::1`). Private, link-local, and cloud-metadata ranges stay blocked |

`allow_local` resolution: TOML > env > default off.

Search-domain policy resolution: requirements → user `config.toml` → managed → default (unset). A configured policy cannot be bypassed by the model.

Backend search runs only when the **web-search model** sets `supports_backend_search = true` (and the build enables it). It does not depend on `api_backend`. Custom model:

```toml
[models]
web_search = "my-custom-model"

[model.my-custom-model]
model = "my-custom-model"
supports_backend_search = true
```

Sandbox: `web_search`, `web_fetch`, and the LLM API always have network access, including under the `workspace` profile.

## Scripting

```bash
# Human-readable
grok -p "Search the web for ACP session/prompt. Fetch the official page. Summarise the JSON-RPC shape." \
  --always-approve --no-auto-update

# Parse the answer
grok -p "Search the web for Agent Client Protocol. Return JSON array of {title, url}." \
  --disallowed-tools "web_fetch" --always-approve --output-format json \
  | jq -r '.text'

# Schema-constrained
grok -p "Search the web for the ACP overview. Fill the schema from live search only." \
  --always-approve \
  --json-schema '{"type":"object","properties":{"hits":{"type":"array","items":{"type":"object","properties":{"title":{"type":"string"},"url":{"type":"string"}},"required":["title","url"]}}},"required":["hits"]}'

# Two calls, one session: search, then fetch
SID=$(grok -p "Search the web for ACP protocol overview. List title+URL only. Do not fetch." \
  --disallowed-tools "web_fetch" --always-approve --output-format json | jq -r '.sessionId')
grok -p "Fetch the official docs URL from that list and extract the session lifecycle." \
  --resume "$SID" --always-approve
```

JSON `usage.server_tool_use.web_search_requests` counts **successful backend searches only**. Failed searches and `open_page` are excluded. There is no `web_fetch_requests` key.

Headless does not read piped stdin as the prompt. Use `-p` or `--prompt-file`.

## Common mistakes

- **Using this path for X posts** — you get titles/URLs or scraped HTML. Use [grok-p-x-search.md](./grok-p-x-search.md).
- **Omitting `--always-approve` on a fetch** — hangs on a permission prompt.
- **`--disable-web-search` when you only wanted to block fetch** — that kills search too. Use `--disallowed-tools web_fetch` or `GROK_WEB_FETCH=0`.
- **`--tools web_search` vs `--allow WebSearch`** — first is the tool ID allowlist; second is a permission rule. Different languages.
- **`--allow 'WebFetch(domain:*.example.com)'`** — wildcards are not valid inside `domain:`. Use `WebFetch(domain:example.com)` (covers subdomains) or a URL glob.
- **Fetching a Google Doc / private GitHub URL** — `web_fetch` will fail. Use the matching MCP/auth surface.
- **Expecting `num_results` as a CLI flag** — it is a tool argument. Put “return 20 hits” in the brief.
- **Piping the brief on stdin** — ignored.

## Relation to Orbital

When a Grok adapter lands under `packages/adapters/grok/`, this is the headless contract for open-web retrieval: spawn `grok -p` (or `grok agent stdio`) with `--always-approve`, put the query/URL in the prompt, optionally `--tools web_search,web_fetch` or `--disallowed-tools` to lock the path, parse `--output-format json` / `--json-schema`. Do not treat `web_search` as an X index.

Imagine (stills / video): [grok-p-imagine.md](./grok-p-imagine.md). ACP path: `grok agent stdio` — see [grok-build.md](./grok-build.md).
