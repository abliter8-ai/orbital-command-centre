# AGENTS.md — a8 Orbital Command Centre

## Project Overview

**a8 Orbital Command Centre (OCC)** is a multi-protocol agent control plane and adaptor layer.

Its primary goal is to let a high-level orchestrator (example Claude Code) treat other coding agents as first-class **sub-agents**. This enables:

- Token savings (Claude plans & reviews; specialised or cheaper agents implement)
- Access to models and runtimes otherwise unavailable inside a single agent
- Clean interop across three surfaces:
  1. **MCP** – `delegate_to_*` tools for Claude Code and other MCP clients
  2. **ACP** – Agent Client Protocol for editors and unified UIs
  3. **A2A** – Agent-to-Agent protocol for peer discovery and delegation

The internal contract is an **AgentHandle**. MCP, ACP and A2A are façades over the same handles. Adapters turn concrete coding agents (Codex, Cursor, Pi, OpenCode, Grok, …) into AgentHandles.

## Current Status

IP-001 is implemented: `@occ/core`, `@occ/adapter-codex` (`codex exec --json`), and `@occ/mcp-facade` (`occ_health`, `delegate_to_codex`). ACP, A2A, and the control-plane daemon are not built.

Plans live in `docs/`. Study copies of protocol repos live beside this git repo at `../vendored` (gitignored here). Do not add them as a runtime dependency.

## Core Design Principles

1. **AgentHandle is the single internal contract**  
   Lifecycle, prompting, streaming, cancellation and capabilities live here. Do not leak protocol-specific details into the core.

2. **Façades are thin**  
   MCP, ACP and A2A should translate to/from AgentHandle. Prefer composition over deep inheritance.

3. **Adapters are thin**  
   An adapter’s job is to turn one external agent (CLI, ACP server, A2A server, etc.) into an AgentHandle. Reuse vendored code aggressively.

4. **MVP order matters**  
   Prefer delivering real sub-agent value (MCP tools) before perfect protocol coverage.

5. **Do not reinvent transports**  
   Use current published SDKs. MCP façade: `@prefecthq/fastmcp-ts` (MCP SDK v2 / 2026-07-28). Claude Code 2.1+ does not fall back to pre-2026-07-28. Study vendored snapshots (ACP TS SDK, a2a-js, a2a-adapter, punkpeye FastMCP); do not depend on the vendored FastMCP tree — it is MCP SDK v1.

## Package Layout

Present:

```
packages/
  core/                 # AgentHandle, Task/Session model, types, registry
  adapters/codex/       # Codex CLI adapter
  mcp-facade/           # FastMCP tools (delegate_to_codex)
```

Planned, do not invent early:

```
packages/acp
packages/a2a
packages/adapters/{cursor,opencode,pi,…}
packages/control-plane
```

Keep the core package free of concrete protocol or CLI dependencies.

## Priority Order for Work

When deciding what to implement or improve:

1. **Core AgentHandle + Task/Session model**
2. **One solid adapter** (prefer Codex, Grok or Cursor)
3. **MCP façade** exposing `delegate_to_<agent>` tools that Claude Code can call
4. Second adapter + basic local registry
5. A2A server surface on the same handles
6. Full control-plane daemon (lifecycle, isolation, permissions, multi-session)

## Rules for Agents Working in This Repo

- Prefer extending the existing architecture over introducing parallel abstractions.
- When adding a new target agent, implement an adapter that satisfies `AgentHandle` rather than special-casing it in the façades.
- Keep the MCP tools ergonomic for Claude Code: clear names, good descriptions, structured results that are easy to review.
- Reuse and study the vendored repositories instead of copying large amounts of protocol code.
- Preserve isolation: delegated agents should ideally run in their own context / worktree / sandbox where practical.
- Document any new public tool or AgentHandle method clearly so other agents (and future OCC itself) can use it.

## Coding Conventions

- Language: TypeScript preferred for the control plane and façades (matches the majority of the vendored SDKs).
- Keep public interfaces small and stable.
- Prefer explicit types over heavy inference for the core contract.
- Tests should focus on the AgentHandle contract and the MCP tool path first.
- Avoid large “god” modules; keep adapters and transports focused.

## Documentation Standards
- All major work requires a structured implementation plan written to 'docs/b-implementation_plans'
- When that work is complete, you write a Completion Report to 'docs/c-completion-reports'
- If you are unable to complete a task or you are asked to give a handoff write to 'docs/c-completion-reports'
- The user will sometimes provide unstructured content in 'docs/a-ideas' - these are not authorised or approved plans, they are ideas/patterns/or information for you to consider when developing a plan.

## Useful Context

- README.md contains the high-level vision, loop, and roadmap.
- Docs: `docs/a-ideas`, `docs/b-implementation_plans`, `docs/c-completion-reports`, `docs/d-handoffs`.
- Vendored references live under `../vendored` (workbench, not in this git repo). Study them before inventing new protocol handling.
- The logo and branding use a pixel-art satellite + “OCA” motif.
- Build/test: `pnpm install && pnpm test && pnpm build`. MCP entry: `packages/mcp-facade/dist/stdio.js`.

## What Success Looks Like for the First Milestone

Claude Code (or any MCP client) can:

1. Call a tool such as `delegate_to_codex` or `delegate_to_cursor` with a clear brief.
2. The corresponding agent runs (via the adapter).
3. A structured result (or useful summary + diff) is returned.
4. Claude can review and continue.

Once that loop is reliable, the same AgentHandles can be exposed over ACP and A2A.

---

When in doubt, optimise for a clean AgentHandle and a working MCP sub-agent path.
