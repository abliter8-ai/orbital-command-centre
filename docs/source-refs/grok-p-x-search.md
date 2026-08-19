# grok -p + native X search

Captured: 2026-08-19.
Applies to Grok Build CLI headless mode on this machine. General headless/ACP flags live in [grok-build.md](./grok-build.md). Official CLI reference: `~/.grok/docs/user-guide/14-headless-mode.md`.

This is the recipe for asking `grok -p` to pull **live posts from X**, not a Google-style scrape of x.com.

## Do not say "web search"

`grok -p` has two different retrieval paths:

| Path | What it is | What you get for "latest Anthropic posts" |
|------|------------|-------------------------------------------|
| Generic `web_search` / `web_fetch` | Indexed web | News writeups, stale hits, x.com HTML, often not the posts |
| Native X tools | Live X index | The actual posts, handles, dates, engagement, thread context |

If the prompt says "do a web search for the latest X posts", the model will often take the weak path. Name **X search**, the **handle**, and **Latest**.

Official Anthropic account is **`@AnthropicAI`**, not `@Anthropic`.

## Canonical command

```bash
grok -p "Search X for the latest posts from @AnthropicAI. Use X keyword search from:AnthropicAI, Latest mode, last 7 days. List the 10 most recent with date, URL, and a one-line gist. Do not use generic web search." --always-approve
```

`--always-approve` (alias `--yolo`) is required in scripts. Without it, headless mode can hang on a tool-permission prompt.

To close the weak path entirely:

```bash
grok -p "Latest posts from @AnthropicAI on X. from:AnthropicAI, Latest, last 7 days. 10 posts: date, URL, gist." \
  --disable-web-search --always-approve
```

`--disable-web-search` removes `web_search` and `web_fetch`. Native X tools stay available.

## Prompt recipe

Put these in the prompt. The CLI does not take X operators as flags; they go in the English brief.

1. **Say "X" / "X keyword search"**, never "web search".
2. **Handle with `from:`** — `from:AnthropicAI`.
3. **Sort** — `Latest` for recency, `Top` for engagement. Capitalise the first letter; that is what the tool expects.
4. **Window** — `last 7 days`, or `since:2026-08-12`, or `within_time:7d`.
5. **Shape of the answer** — "10 posts: date, URL, gist" (or JSON, see below).
6. **Optional exclusions** — ` -filter:replies` for original posts only.

Copy-paste briefs:

```text
# Recency, original posts only
Search X. Keyword query: from:AnthropicAI -filter:replies. Mode: Latest. Window: last 7 days. Return the 10 most recent: date, URL, full text.

# What they are talking about, not just the last tweet
Semantic search X for Anthropic product announcements and model releases. Restrict to username AnthropicAI. Last 14 days. Summarise themes, then cite 5 posts with URLs.

# Thread after you already have an ID
Fetch the full X thread for post id <ID>, including parent and replies.
```

`--verbatim` sends the prompt exactly as written (no CLI rewriting). Use it when the brief is already a finished operator string.

## Native X tools

These are built into this Grok agent. They are **not** MCP tools and they are **not** `web_search`.

| Tool | Use for | Limits |
|------|---------|--------|
| `x_keyword_search` | Operator queries (`from:`, dates, filters) | `limit` default 3, max 10. `mode`: `Top` or `Latest` |
| `x_semantic_search` | Meaning ("product launch", "safety paper") rather than keywords | `limit` default 3, max 10. Optional `usernames`, `from_date`/`to_date` (`YYYY-MM-DD`), `min_score_threshold` (default 0.18) |
| `x_user_search` | Resolve a name/handle to an account | `count` default 3 |
| `x_thread_fetch` | One post + parent + replies | `post_id` only |

`--tools` allowlists **built-in tool IDs** such as `web_search`, `web_fetch`, `read_file`. Do not assume `x_keyword_search` is a valid `--tools` name; it is not documented in the CLI tool filter list. Steer with the prompt, and use `--disable-web-search` if you need a hard block on the web path.

Ten hits is the ceiling **per call**. For more, resume the session (`-c`) and ask for the next page / older window, or run a second query with `max_id:` / `until:`.

## Keyword operators

Passed inside the prompt as the query string. Spaces are AND. `OR` must be uppercase. Parentheses group. `-` negates.

**Content**

| Operator | Meaning |
|----------|---------|
| `keyword` | Implicit AND |
| `OR` | Either term |
| `"exact phrase"` | Phrase match |
| `"phrase with * wildcard"` | Phrase with wildcard |
| `+term` | Require this term |
| `-term` | Exclude this term |
| `url:domain` | Posts linking that domain |

**Account**

| Operator | Meaning |
|----------|---------|
| `from:user` | Authored by handle (no `@`) |
| `to:user` | Replies to handle |
| `@user` | Mentions |
| `list:id` / `list:slug` | List membership |

**Time / ID**

| Operator | Meaning |
|----------|---------|
| `since:YYYY-MM-DD` | From date |
| `until:YYYY-MM-DD` | Up to date |
| `since:YYYY-MM-DD_HH:MM:SS_TZ` / `until:…` | Timestamped window |
| `since_time:unix` / `until_time:unix` | Unix seconds |
| `since_id:id` / `max_id:id` | Cursor by post ID |
| `within_time:7d` | Relative (`Xd` / `Xh` / `Xm` / `Xs`) |

**Post type** (most can be negated with `-`)

`filter:replies`, `filter:self_threads`, `filter:quote`, `conversation_id:id`, `quoted_tweet_id:ID`, `quoted_user_id:ID`, `in_reply_to_tweet_id:ID`, `in_reply_to_user_id:ID`, `retweets_of_tweet_id:ID`, `retweets_of_user_id:ID`

**Engagement**

`filter:has_engagement`, `min_retweets:N`, `min_faves:N`, `min_replies:N`, `-min_retweets:N`, plus `retweeted_by_user_id:ID` / `replied_to_by_user_id:ID`

**Media**

`filter:media`, `filter:twimg`, `filter:images`, `filter:videos`, `filter:spaces`, `filter:links`, `filter:mentions`, `filter:news`

Worked queries to drop into the brief:

```text
from:AnthropicAI -filter:replies since:2026-08-12
from:AnthropicAI (Claude OR "Claude Code") filter:links Latest
from:AnthropicAI min_faves:50 within_time:30d
from:AnthropicAI -filter:replies -filter:quote
```

Geo (`geocode:lat,long,radius`) exists but is rarely useful; most posts are not geo-tagged.

## Headless flags that matter here

| Flag | Why |
|------|-----|
| `-p, --single <PROMPT>` | One shot; print to stdout; exit |
| `--always-approve` / `--yolo` | Do not block on tool approval |
| `--disable-web-search` | Force the X path |
| `--verbatim` | Do not rewrite the brief |
| `--output-format json` | `{ text, stopReason, sessionId, … }` — pipe `.text` |
| `--json-schema '<json>'` | Constrain the **model output** to a schema (implies json format) |
| `--prompt-file <PATH>` | Long briefs; stdin is **not** the prompt |
| `-c` / `-r <id>` | Continue / resume so you can thread-fetch after a search |
| `--max-turns <N>` | Cap tool loops |
| `--no-auto-update` | Scripts / CI |

Headless does not read piped stdin as the prompt. Use command substitution or `--prompt-file`:

```bash
grok --prompt-file ./x-anthropic.txt --disable-web-search --always-approve
```

## Scripting

Human-readable:

```bash
grok -p "Latest 10 posts from:AnthropicAI on X, Latest, last 7 days. Date, URL, gist." \
  --disable-web-search --always-approve --no-auto-update
```

JSON out, parse the answer text:

```bash
grok -p "Latest 10 posts from:AnthropicAI on X. Return a JSON array of {date, url, text}." \
  --disable-web-search --always-approve --output-format json \
  | jq -r '.text'
```

Schema-constrained (better for adapters):

```bash
grok -p "Latest posts from:AnthropicAI on X, Latest, last 7 days. Fill the schema from live X search only." \
  --disable-web-search --always-approve \
  --json-schema '{"type":"object","properties":{"posts":{"type":"array","items":{"type":"object","properties":{"date":{"type":"string"},"url":{"type":"string"},"text":{"type":"string"}},"required":["date","url","text"]}}},"required":["posts"]}'
```

Follow-up in the same session:

```bash
grok -p "Now fetch the full thread of the most-engaged post from that list." -c --always-approve
```

Capture a session id from json, then resume later:

```bash
SID=$(grok -p "Latest 5 from:AnthropicAI on X, Latest." \
  --disable-web-search --always-approve --output-format json | jq -r '.sessionId')
grok -p "Fetch the thread for the first post." --resume "$SID" --always-approve
```

## Common mistakes

- **"Web search for tweets"** — hits `web_search`. Say **X keyword search**.
- **`from:@AnthropicAI`** — the operator is `from:AnthropicAI` (no `@`).
- **`@Anthropic`** — wrong account. Resolve first with `x_user_search` if unsure.
- **`mode: latest`** — the tool wants `Latest` or `Top`.
- **Asking for 50 posts in one shot** — max 10 per `x_keyword_search` / `x_semantic_search` call.
- **Omitting `--always-approve` in a script** — hangs on permission.
- **Piping the brief on stdin** — ignored. Use `-p "…"` or `--prompt-file`.
- **Allowlisting `--tools web_search`** — that is the wrong tool for this job.

## Relation to Orbital

When a Grok adapter lands under `packages/adapters/grok/`, this is the headless contract for live X retrieval: spawn `grok -p` (or `grok agent stdio`) with `--always-approve --disable-web-search`, put operators in the prompt, parse `--output-format json` / `--json-schema`. Do not wrap `web_search` and pretend it is X.

Open web: [grok-p-web-search.md](./grok-p-web-search.md). Imagine (stills / video): [grok-p-imagine.md](./grok-p-imagine.md). ACP: `grok agent stdio` — see [grok-build.md](./grok-build.md).
