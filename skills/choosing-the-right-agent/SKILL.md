---
name: choosing-the-right-agent
description: >
  Use when deciding which Orbital OCC agent (Codex, Cursor, Grok, Antigravity)
  should take a job, or when a task needs a native capability (live X search,
  image/video generation, grounded web research, browser automation, plan-mode
  analysis) and the right tool is unclear. Complements the four
  delegating-to-* skills with the routing layer.
---

# Choosing the right agent (OCC)

Four agents, four different strengths. Pick by **capability first**, model
second. `occ_capabilities` returns this same map programmatically;
`occ_models` returns the live per-agent model lists; `occ_health` says who is
actually usable right now.

## Routing table

| Job | Agent | Tool |
| --- | --- | --- |
| Live X posts, threads, engagement | Grok | `grok_x_search` (thread fetch: `delegate_to_grok`) |
| Image generation / edit | Grok | `grok_imagine` |
| Short video from a still | Grok | `grok_video` (stage the still first) |
| Grounded web research (search + fetch) | Antigravity | `antigravity_research` (`preflight: "fix"` grants `read_url(*)` once) |
| Open-web search, quick | Grok | `delegate_to_grok` (name `web_search`) |
| Browser automation (click/type/DOM) | Antigravity | `delegate_to_antigravity`, pre-allowed `execute_url` or danger-full-access |
| Code review of a diff / branch / commit | Codex | `codex_review` (never the agent that wrote the diff) |
| Hard / ambiguous implementation | Codex | `delegate_to_codex` (`gpt-5.6-sol`, high effort) |
| Everyday implementation, tests, refactors | Codex or Cursor | `delegate_to_codex` (terra) / `delegate_to_cursor` |
| Show the agent a screenshot / mock / diagram | Codex | `delegate_to_codex` with `images: [abs paths]` |
| Read-only repo Q&A / plan | Cursor or Codex | `sandbox: "read-only"` (Cursor `--mode ask` is cheapest) |
| A specific model by name (200+ catalog) | Cursor | `delegate_to_cursor` + slug from `occ_models` |
| Second opinion from a clean-context Claude | Claude | `delegate_to_claude` (`sandbox: "read-only"`) |
| Orchestrator is Cursor/Codex/Grok, task wants Claude's tier | Claude | `delegate_to_claude` (the flip — same orbital server, their MCP config) |
| Server-side web search/fetch without permission setup | Claude | `delegate_to_claude` (name WebSearch/WebFetch in the brief) |
| Architecture, security review, final judgment | **Claude itself** | do not delegate |

## Rules of thumb

1. **Capability beats loyalty.** If the job is "what are people saying on X",
   the answer is Grok even if the user's repo is Codex-shaped.
2. **Health before routing.** A perfect choice that is unauthenticated is a
   failed turn. `occ_health` first when in doubt.
3. **One agent owns the diff.** Never let two agents write the same tree in
   parallel; sequence them (implement → review) instead.
4. **Review stays home — or crosses over.** Claude keeps final judgment. A
   second opinion goes to `codex_review` (or a clean-context
   `delegate_to_claude`), and never to the agent that wrote the diff.
5. **Native tools need their flags.** Grok X/Imagine hang under `read-only`
   (use the first-class tools); agy web tools soft-deny without allow-rules
   (`antigravity_research` pre-flights this — `"fix"` merges the rule with a
   backup).

## When two agents qualify

- **Web research:** Grok for speed and X-adjacent topics; Antigravity when the
  answer needs grounded Google results or a fetched page's full content.
- **Implementation:** Codex for hard/multi-file; Cursor when a specific model
  (composer, a Claude slug, a parameterized effort) is the point.
- **Fan-out research:** Antigravity subagents (ask in the brief) or several
  parallel `delegate_to_*` calls with disjoint scopes.

## Other surfaces (not MCP)

The same four handles are reachable without this MCP server: editors speak ACP
(`occ-acp --agent <id>` over stdio), other agents speak A2A
(`occ-a2a --agent <id> --port N`, or the `orbital` daemon hosting all four
behind `http://127.0.0.1:7100/agents/<id>` with policy caps and an audit log).
If the user asks about Zed integration or agent-to-agent delegation, point at
those — inside Claude Code, the MCP tools above remain the right path.
