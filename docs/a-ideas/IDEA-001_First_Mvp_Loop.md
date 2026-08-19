# IDEA-001 — First useful OCC loop

**Date:** 2026-08-19 · **Status:** ready-for-ip

## Problem / opportunity

OCC is branding and vision only. Claude Code still cannot treat Codex (or any other coding agent) as a first-class sub-agent. The cost of leaving it: clipboard orchestration, no shared runtime contract, and the roadmap (ACP / A2A / control-plane) has nothing to hang on.

`docs/starting-overview.md` already states the highest-ROI sequence. This IDEA just names it so an IP can be approved against it.

## Current state

Inspected 2026-08-19:

- `a8-orbital-command-centre` is a git repo (`abliter8-ai/orbital-command-centre`) containing `README.md`, `AGENTS.md`, and `assets/`. No `packages/`, no tests, no MCP server.
- Planning docs and vendored references live in the parent workbench (`a8-agent-client-protocol/docs`, `…/vendored`). Parent is not a git repo. OCC `.gitignore` already excludes `vendored/`.
- Ruin-max has the CLIs the first loop needs: Codex 0.148.0, Grok 1.0.5, Cursor `agent`, Claude Code 2.1.235.

## Desired outcome

A Claude Code session on this machine can call `delegate_to_codex` with a brief and receive a structured result (summary + last message + files changed). Internally that path is `AgentHandle`, not an MCP special-case.

Observable: one MCP tool, one real adapter, contract tests that do not require a live model, plus a documented live smoke.

## Research notes

See IP-001 grounding appendix. Headline correction to the scaffolding docs: vendored `fastmcp-ts` (punkpeye, MCP SDK v1) will not talk to Claude Code 2.1.235, which does not fall back to pre-2026-07-28 MCP.

## Open questions for David

All moved into IP-001 decisions. No extra questions here.

## Next step

IP-001 (`core-handle-codex-mcp`).
