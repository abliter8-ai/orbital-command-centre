
### Recommended Architecture (High Level)

Treat everything as an **AgentHandle / Runtime**:

- Lifecycle: spawn / resume / cancel
- Interaction: prompt → streaming updates → result
- Capabilities + permissions
- Session / task identity

Then provide three façades on top of the same handles:

1. **MCP façade** (FastMCP) → Claude Code (and other MCP clients) see `delegate_to_codex`, `delegate_to_cursor`, etc. This is the sub-agent pattern.
2. **ACP server/client** → editors and unified UIs can drive the agents.
3. **A2A server/client** → agents can discover and delegate to each other.

The control-plane daemon (“Orbital”) manages process lifecycle, routing policy, isolation (worktrees/sessions), permission mediation, and a local registry.

### Suggested Monorepo Structure

```
a8-orbital-command-centre/
├── packages/
│   ├── core/                 # AgentHandle interface, Task/Session model, registry client, types
│   ├── mcp-facade/           # FastMCP tools (delegate_to_*)
│   ├── acp/                  # ACP transport (build on vendored ACP TS SDK + claude-agent-acp / codex-acp)
│   ├── a2a/                  # A2A transport (a2a-js + patterns from a2a-adapter)
│   ├── adapters/
│   │   ├── codex/
│   │   ├── cursor/
│   │   ├── pi/
│   │   ├── opencode/
│   │   └── grok/             # often via Cursor or Grok Build CLI
│   ├── bridge/               # optional multi-protocol router (inspired by a2a-bridge)
│   └── control-plane/        # the actual daemon / CLI
├── vendored/                 # your collected repos (or git submodules)
├── examples/
└── docs/
```

### Concrete Starting Sequence (Highest ROI Order)

**Phase 1 – Core + one working delegation path**

1. **Define the internal interface** in `packages/core`
   - `AgentHandle` with `startSession`, `prompt`, `onUpdate`, `cancel`, `getCapabilities`
   - Simple Task / Session model (id, status, result, parent)

2. **Wire the first adapter** using what you already vendored
   - Start with **Codex** via `codex-acp` (or CLI) **or** **Cursor** via `cursor-agent-a2a` / ACP.
   - Make a thin adapter that implements `AgentHandle`.

3. **Expose it as MCP tools** with FastMCP
   - `delegate_to_codex({ brief, cwd, model?, sandbox? })`
   - `delegate_to_cursor(...)`
   - Return a structured result (or stream status) that Claude can review.
   - This immediately gives you the sub-agent pattern Claude Code users want.

4. **Document the exact loop**
   - Claude plans → calls the MCP tool with a precise brief → external agent works → Claude reviews the diff/result.

At this point you already have a useful product: Claude Code can offload work.

**Phase 2 – Second agent + A2A surface**

5. Add a second adapter (Cursor if you started with Codex, or vice-versa; then Pi / OpenCode via `a2a-adapter` patterns).
6. Expose the same `AgentHandle`s as **A2A servers** (reuse `a2a-js` + the Agent Card / task lifecycle patterns from `a2a-adapter`).
7. Add a minimal local registry (inspired by ACP Registry) so the control plane can discover what is available.

**Later**

- Full control-plane daemon (process supervision, multi-session isolation, permission broker, routing policy).
- Integration with `cc-multi-cli-plugin`-style slash commands / skills for nicer Claude UX.
- Worktree / sandbox isolation, cost tracking, audit log.
- Optional UI or dashboard.

### How to Leverage Your Vendored Code

| Vendored piece              | Best use in Orbital                          |
|----------------------------|----------------------------------------------|
| ACP TS SDK + claude-agent-acp / codex-acp | ACP transport + ready coding-agent servers  |
| a2a-js + a2a-adapter       | A2A transport + patterns for wrapping CLIs  |
| cursor-agent-a2a           | Ready Cursor A2A server                     |
| FastMCP                    | Claude-facing `delegate_to_*` tools         |
| a2a-bridge                 | Inspiration (and possible code) for multi-protocol routing |
| cc-multi-cli-plugin        | UX patterns and command design for Claude   |
| ACP Registry               | Discovery model                             |

Do **not** try to unify every protocol and every agent in the first PR. Get one solid `AgentHandle` → MCP tool path working end-to-end. Everything else becomes easier once that internal contract is stable.

### First Commit Suggestion

- Add the monorepo skeleton + `packages/core` with the `AgentHandle` interface and a trivial in-memory task store.
- Add one real adapter (Codex or Cursor) that implements it.
- Add a FastMCP server that exposes a single `delegate_to_X` tool.
- README that shows the exact Claude Code → delegate → review loop.
