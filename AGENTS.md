# AGENTS.md — a8 Orbital Command Centre

## Project Overview

**a8 Orbital Command Centre (OCC)** is a multi-protocol agent control plane and adapter layer.
It lets a high-level orchestrator (e.g. Claude Code) treat other coding agents as first-class **sub-agents**:

- Token savings (the orchestrator plans & reviews; specialised or cheaper agents implement)
- Access to models and native tools otherwise unavailable inside a single harness (Grok's live X index and Imagine media generation, Antigravity's grounded Google search, …)
- Clean interop across three surfaces over one internal contract:
  1. **MCP** — `delegate_to_*` + `occ_*` tools for Claude Code and other MCP clients
  2. **ACP** — Agent Client Protocol over stdio for editors (Zed-style)
  3. **A2A** — Agent-to-Agent JSON-RPC over HTTP for peer discovery and delegation

The internal contract is an **AgentHandle** (`packages/core`). MCP, ACP and A2A are façades over the same handles. Adapters turn concrete coding-agent CLIs (Codex, Cursor, Grok, Antigravity) into AgentHandles.

## Current Status

All five adapters and all three surfaces are built and live-verified, plus the control-plane daemon:

- **MCP façade** (`@occ/mcp-facade`): `occ_health`, `occ_models`, `occ_tasks`, `occ_cancel`, `occ_capabilities`, `delegate_to_{codex,cursor,grok,antigravity,claude}` (Codex takes `images`), and first-class native tools `codex_review`, `antigravity_research` (permission pre-flight), `grok_x_search`, `grok_imagine`, `grok_video`. The façade is harness-agnostic: registered in `~/.cursor/mcp.json` or `~/.codex/config.toml`, Cursor or Codex becomes the orchestrator and can `delegate_to_claude` (the flip). The installers do this registration automatically when those harnesses are detected (`scripts/register-flip.mjs` — backup-first, idempotent; `--no-mcp` opts out).
- **ACP** (`@occ/acp`): `occ-acp --agent <id>` over stdio; session modes map to OCC sandboxes. Streaming handles (Codex, Cursor, Claude) emit live `tool_call` updates and `agent_message_chunk`s; buffered handles deliver one chunk at turn end.
- **A2A** (`@occ/a2a`): `occ-a2a --agent <id> --port N`; agent cards generated from the capability profile; `SendMessage` / `SendStreamingMessage` (SSE) / `GetTask` / `ListTasks` / `CancelTask` / `SubscribeToTask`, cards advertise `streaming: true`. Tasks are durable server-side state: `FileTaskStore` (`src/stores.ts`) persists every save atomically to `~/.occ/a2a-tasks/` (per-agent files, `OCC_A2A_TASKS_DIR` override, 7-day terminal-task TTL at boot, corrupt-file quarantine), so tasks survive kill -9 and restart; clients re-attach via `ListTasks` + `GetTask` (see README "Long tasks and re-attachment"). `stores.ts`/`http.ts` normalize two `@a2a-js/sdk` wire quirks at the boundary (absent `status` filter decoding to `TASK_STATE_UNSPECIFIED` and breaking `ListTasks`; `"user"`/`"agent"` roles decoding to `UNRECOGNIZED`) — keep those shims; regression tests live in `packages/a2a/test/http.test.ts` and `stores.test.ts`.
- **Control plane** (`@occ/control-plane`): `orbital up|down|status|audit|logs` — one loopback port hosting all agents under `/agents/<id>`, registry (`/v1/registry`), policy mediation (`~/.occ/orbital.json`: `enabled`, `maxSandbox`, `defaultModel`, `isolation`), append-only audit log (`~/.occ/audit.jsonl`). `isolation: "worktree"` runs each delegation in a throwaway `git worktree` detached at HEAD (created under `~/.occ/worktrees`, removed after; stale ones swept at startup).
- **Model catalog** live-probed from the installed CLIs into `~/.occ/model-catalog.json` (24h staleness self-refresh; `scripts/update-models.sh|ps1`).

## Package Layout

```
packages/
  core/                 # AgentHandle, Task/Session model, registry, task store,
                        # capabilities map, model catalog (no protocol or CLI deps)
  adapters/kit/         # shared spawn / cwd / process-tree kill (no protocol types)
  adapters/codex/       # codex exec --json
  adapters/cursor/      # cursor-agent -p (never `agent` — that name is Grok on some PATHs)
  adapters/grok/        # grok -p --output-format json (+ native X / Imagine / video briefs)
  adapters/antigravity/ # agy -p --output-format json (never `gemini`)
  adapters/claude/      # claude -p --output-format stream-json (the flip target)
  mcp-facade/           # FastMCP tools for Claude Code
  acp/                  # ACP server over stdio (@agentclientprotocol/sdk)
  a2a/                  # A2A server over node:http (@a2a-js/sdk, no express)
  control-plane/        # orbital daemon: registry, policy, audit, lifecycle
skills/                 # Claude Code skills (delegating-to-*, choosing-the-right-agent)
scripts/                # install.sh|ps1, update-models.sh|ps1
```

Keep `core` free of concrete protocol and CLI dependencies. Façades depend on adapters, never the reverse.

## Core Design Principles

1. **AgentHandle is the single internal contract.** Lifecycle, prompting, cancellation and capabilities live here. Do not leak protocol-specific details into core.
2. **Façades are thin.** MCP, ACP, A2A and the daemon translate to/from AgentHandle. Shared domain data (capabilities, catalog) lives in core, not in a façade.
3. **Adapters are thin.** One external CLI → one AgentHandle. Shared spawn/kill/parse logic goes in `adapters/kit`.
4. **Do not reinvent transports.** Use published SDKs: `@prefecthq/fastmcp-ts` (MCP), `@agentclientprotocol/sdk` (ACP), `@a2a-js/sdk` (A2A). Vendored snapshots beside this repo (`../vendored`) are for study only — never a runtime dependency.
5. **Honesty over gloss.** If a capability is not streaming, advertise `streaming: false`. If a native tool fails server-side (e.g. ZDR Grok accounts and video), return the reason — never fake success.

## Adapter Invariants (hard-won — do not regress)

- OCC never passes `--dangerously-bypass-approvals-and-sandbox` (Codex). `danger-full-access` maps to each CLI's own documented full-access flags only.
- Codex write path is `--approve-for-me` (0.148 refuses `--sandbox` combined with it).
- `codex exec review` takes a narrow flag set: no `--cd`, no `--sandbox`, and the target flags (`--uncommitted` / `--base` / `--commit`) are mutually exclusive with a custom `[PROMPT]`. OCC emits a prompt only for `target: custom`.
- Streaming is event-level, not token-level: `PromptRequest.onEvent` carries `text` / `tool_start` / `tool_end`. Codex, Cursor, and Claude emit (Cursor only in write sandboxes — read-only is buffered `--output-format json`); Grok and Antigravity stay buffered and advertise `streaming: false` on the handle.
- Claude children always run `--strict-mcp-config` with an empty MCP config — a delegated Claude must never inherit the orchestrator's MCP servers (nested orbital fan-out). Sandbox maps to `--permission-mode` (`plan` / `acceptEdits` / `bypassPermissions`); there is no effort flag (baked into model choice); `filesChanged` is derived from Edit/Write `tool_use` blocks and per-run cost rides in the summary.
- Cursor write path is `cursor-agent -p --force --trust` with stream-json; read-only is `--mode ask`. Spawned Cursor processes set `AGENT_CLI_CREDENTIAL_STORE=file` (locked macOS keychain workaround).
- Grok headless is `grok --no-leader -p --output-format json --verbatim`; write path adds `--always-approve`; OS `--sandbox` is **not** passed (hangs 1.0.5). X-search/Imagine briefs must not run under `read-only` (tool approval hang) — the first-class tools handle this.
- Antigravity web tools soft-deny without `permissions.allow` rules in the user's settings; document, don't work around.
- Cancellation and timeout kill the whole process group (SIGTERM → 4s grace → SIGKILL; `taskkill /T /F` on Windows) via `adapters/kit`.
- Availability probes are cheap and read-only (`--version`, auth status) — never spawn a prompt turn to probe.

## Build, Test, Verify

- Node ≥22, pnpm 10. `pnpm install && pnpm build` (topological via `pnpm -r build`).
- **Run tests from the repo root**: `pnpm test` (vitest include paths are root-relative; per-package `vitest run` finds nothing).
- Entry points: MCP `packages/mcp-facade/dist/stdio.js` · ACP `packages/acp/dist/stdio.js` · A2A `packages/a2a/dist/server-cli.js` · daemon `packages/control-plane/dist/cli.js`.
- Live verification convention: real CLI round-trips ("Reply with exactly: PONG") per surface, plus evidence in the commit/PR description.

## Rules for Agents Working in This Repo

- Extend the existing architecture; do not introduce parallel abstractions (new agent → new adapter satisfying `AgentHandle`; new surface → new façade over the registry).
- Keep MCP tools ergonomic for orchestrators: clear names, honest descriptions, structured results that are easy to review.
- New public tool, handle method, or daemon route → document it in the README section for that surface.
- Sandbox semantics are a security boundary: policy caps in the control plane and per-call `sandbox` in MCP/ACP/A2A must agree. Never widen a caller's requested sandbox.
- Preserve the audit trail: control-plane-mediated delegations must land in `~/.occ/audit.jsonl`, rejections included.

## Useful Context

- `README.md` — vision, install, the Claude Code loop, per-surface usage, roadmap.
- `skills/` — the orchestration playbooks Claude Code loads (`choosing-the-right-agent` is the routing meta-skill).
- Vendored protocol references may exist beside this repo at `../vendored` (gitignored) — study before inventing protocol handling.
- Branding: pixel-art satellite + wordmark in `assets/` (transparent backgrounds — theme-safe; `orbital-logo-black.PNG` is opaque black, avoid on the web). Signature colour is **red `#ff093a`** — use it for badges, rules, and generated brand assets.

---

When in doubt, optimise for a clean AgentHandle and a working, reviewable delegation path.
