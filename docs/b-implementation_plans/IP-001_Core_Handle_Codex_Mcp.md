---
title: "IP-001 Core AgentHandle + Codex adapter + MCP façade"
date: 2026-08-19
status: approved (2026-08-19, decisions 1–7 = recommended defaults)
slug: core-handle-codex-mcp
idea_ref: IDEA-001_First_Mvp_Loop.md
---

# IP-001 — Core AgentHandle + Codex adapter + MCP façade

<!-- Naming: IP-001_Core_Handle_Codex_Mcp.md → CR-001_Core_Handle_Codex_Mcp.md
     David approves before any implementation. status: draft → approved (date, decisions). -->

## Problem Statement

OCC cannot yet do the one thing that justifies its existence: let Claude Code (or any MCP client) hand a precise brief to another coding agent and get a reviewable result back. The repo is branding plus a parent-folder workbench of vendored protocol code. There is no `AgentHandle`, no adapter, no MCP server, and no in-repo docs tree.

Leaving this as vision-only means every later surface (ACP, A2A, daemon, second adapter) has to invent the internal contract under pressure. The first IP exists to lock that contract and prove it with a single live path: **Claude → `delegate_to_codex` → Codex CLI → structured result**.

## Scope

**In:**

- Versioned docs tree inside the OCC git repo (templates + this IDEA/IP pair copied in)
- pnpm TypeScript monorepo skeleton matching `AGENTS.md`
- `packages/core`: `AgentHandle`, session/task types, in-memory task store, tiny registry
- `packages/adapters/codex`: thin `codex exec` adapter (JSONL + last-message file)
- `packages/mcp-facade`: stdio MCP server exposing `delegate_to_codex` (and `occ_health`)
- Contract tests (no live model required) + a documented live smoke on ruin-max
- README loop: how Claude Code registers the server and what a good brief looks like

**Out (explicitly):**

- ACP façade, A2A façade, control-plane daemon, local registry persistence
- Second adapter (Cursor / Grok / Pi / OpenCode) — IP-002
- Worktree / sandbox isolation beyond what `codex exec --sandbox` already provides
- Copying or vendoring `cc-multi-cli-plugin`'s app-server broker
- Depending on the vendored `fastmcp-ts` snapshot (punkpeye / MCP SDK v1)
- Publishing npm packages, licence bikeshed, dashboard, cost tracking, audit log
- Streaming MCP tool results as a hard requirement (progress is nice-to-have)

## Approach & architecture decisions

**Current state (inspected, not assumed).** OCC is a git repo with branding only. Docs and `vendored/` live beside it, not in it. Ruin-max has Codex 0.148.0, Grok 1.0.5, Cursor `agent`, Claude Code 2.1.235, Node 26.7.0, pnpm 10.33.0.

**Recommended change.** Build the three packages `AGENTS.md` already named, and stop at the first closed loop. Façade and adapter stay thin. Core stays protocol-free.

```
Claude Code (MCP client, 2026-07-28)
        │  stdio
        ▼
packages/mcp-facade          FastMCP TS (@prefecthq/fastmcp-ts) — tools only
        │  AgentHandle
        ▼
packages/core                types, InMemoryTaskStore, AgentRegistry
        │
        ▼
packages/adapters/codex      spawn `codex exec --json …`
        │
        ▼
Codex CLI 0.148+             thread/turn/item JSONL + last assistant message
```

**Why Codex `exec`, not ACP and not Grok first.**

- README already names Codex the strongest first target. The product thesis is Claude plans/reviews and Codex implements.
- `codex exec` is the documented non-interactive path. Official events: `thread.started`, `turn.started|completed|failed`, `item.*`, `error`. `item.completed` with `item.type = "agent_message"` is the final answer; `file_change` items give the diff list; `thread_id` is the resume key.
- `--full-auto` is gone as of Codex 0.147 (this box is 0.148). New scripts use `--sandbox workspace-write` plus `--approve-for-me`.
- Grok `-p --output-format json` is a cleaner CLI, but picking it first would prove the wrong offload. Cursor ACP is documented in `docs/source-refs/cursor-acp.md` and is the natural *second* adapter. ACP as Codex's *transport* is a later upgrade of the same handle, not the MVP transport.

**Why `@prefecthq/fastmcp-ts`, not vendored FastMCP.**

This is a correction to `AGENTS.md` / `starting-overview.md`, not a style preference.

| Package | Version (2026-08-19) | MCP SDK | Speaks 2026-07-28? |
| --- | --- | --- | --- |
| vendored `fastmcp-ts` + npm `fastmcp` (punkpeye) | 4.16.5 | `@modelcontextprotocol/sdk` ^1.24.3 | No — handshake / v1 |
| `@prefecthq/fastmcp-ts` | 1.5.1 | `@modelcontextprotocol/server` ^2.0.0 | Yes. Optional Anthropic/OpenAI/Gemini peers. `fastmcp install claude-code`. Node ≥22 |
| `@modelcontextprotocol/server` | 2.0.0 | itself | Yes. Thinner, more glue |

Claude Code **2.1.235** (this machine) contains: *“this client supports no pre-2026-07-28 protocol version to fall back to”* and probes `server/discover`. A v1 FastMCP server will fail handshake. Use Prefect FastMCP (or the official v2 SDK if Prefect's install is painful). Study the vendored snapshot; do not depend on it.

**Why no daemon yet.** One stdio process per Claude session is enough. Session/task state is in-memory for that process. Resume is Codex's `thread_id`, not OCC persistence.

**Isolation stance for this IP.** Inherit the caller's `cwd`. Let Codex's own sandbox be the write fence. Git worktrees and OCC-owned sandboxes are IP-00x later — they need a control-plane.

**Docs stance.** Parent `a8-agent-client-protocol/docs` is the current workbench. This IP is drafted there. Implementation step 0 copies the docs tree *into* the OCC git repo so plans travel with the code `AGENTS.md` already describes.

## Target contract (lock these names)

`packages/core/src/types.ts` — explicit types, no protocol imports:

```ts
export type AgentId = "codex";

export type TaskStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export interface AgentCapabilities {
  streaming: boolean;
  resume: boolean;
  cancel: boolean;
  sandboxModes: SandboxMode[];
}

export interface Availability {
  available: boolean;
  authenticated: boolean;
  detail: string;
  version?: string;
}

export interface Session {
  sessionId: string;
  agentId: AgentId;
  cwd: string;
  createdAt: string; // ISO-8601
}

export interface SessionOptions {
  cwd: string;
  resumeSessionId?: string;
  model?: string;
}

export interface PromptRequest {
  brief: string;
  sandbox?: SandboxMode; // default workspace-write
  timeoutMs?: number;    // default 600_000
}

export interface FileChange {
  path: string;
  change: "add" | "mod" | "del" | "unknown";
}

export interface DelegationError {
  code:
    | "not_available"
    | "not_authenticated"
    | "invalid_cwd"
    | "timeout"
    | "cancelled"
    | "spawn_failed"
    | "agent_failed"
    | "parse_failed";
  message: string;
  hint?: string;
}

export interface DelegationResult {
  taskId: string;
  sessionId: string;
  agentId: AgentId;
  status: TaskStatus;
  cwd: string;
  summary: string;
  output: string;
  filesChanged: FileChange[];
  diffStat?: string;
  durationMs: number;
  usage?: {
    inputTokens?: number;
    cachedInputTokens?: number;
    outputTokens?: number;
  };
  error?: DelegationError;
}

export interface AgentHandle {
  readonly agentId: AgentId;
  readonly displayName: string;
  capabilities(): AgentCapabilities;
  isAvailable(): Promise<Availability>;
  startSession(opts: SessionOptions): Promise<Session>;
  prompt(session: Session, request: PromptRequest): Promise<DelegationResult>;
  cancel(taskId: string): Promise<void>;
  close(session: Session): Promise<void>;
}
```

`promptStream` is **not** on the required interface. Add it later if a façade needs tokens. MCP MVP is request/response.

`summary` = first ~1.5k chars of the last `agent_message` (or a one-line fallback). `output` = full last `agent_message` (or `-o` file contents). `sessionId` = Codex `thread_id`.

`packages/core/src/registry.ts`: `AgentRegistry` with `register` / `get` / `list`. Throws a clear error on unknown id.

`packages/core/src/tasks.ts`: `InMemoryTaskStore` keyed by `taskId`, records status + result. No disk.

`packages/core` **must not** import FastMCP, ACP, A2A, or child_process.

## File map (create)

```
a8-orbital-command-centre/
  package.json                    # private, packageManager: pnpm@10.33.0
  pnpm-workspace.yaml             # packages: packages/core, packages/adapters/*, packages/mcp-facade
  tsconfig.base.json              # NodeNext, strict, ES2023
  vitest.config.ts
  .nvmrc                          # 22 (engine floor; ruin-max is 26)
  docs/                           # copied from parent workbench + templates
  packages/core/
    package.json                  # @occ/core
    src/{index,types,registry,tasks,ids}.ts
    test/{registry,tasks,fake-handle}.test.ts
  packages/adapters/codex/
    package.json                  # @occ/adapter-codex  (depends on @occ/core)
    src/{index,codex-handle,spawn,parse-exec-jsonl,availability}.ts
    test/{parse-exec-jsonl,spawn-args,codex-handle}.test.ts
    test/fixtures/exec-success.jsonl
    test/fixtures/exec-failed.jsonl
    test/fixtures/fake-codex.mjs  # PATH stub
  packages/mcp-facade/
    package.json                  # @occ/mcp-facade  (depends on @occ/core, @occ/adapter-codex,
                                  #   @prefecthq/fastmcp-ts). bin: occ-mcp
    src/{index,server,tools,stdio}.ts
    test/tools.test.ts
```

Do **not** create `packages/acp`, `packages/a2a`, or `packages/control-plane` in this IP.

## Implementation steps

### 0. Docs into the OCC repo

1. Copy parent `docs/a-ideas`, `docs/b-implementation_plans`, `docs/c-completion-reports`, `docs/d-handoffs`, `docs/source-refs`, `docs/starting-overview.md` into `a8-orbital-command-centre/docs/`.
2. Seed templates from `~/.agent-optimisation/docs/{a-ideas,b-implementation_plans,c-completion_reports,h-handoffs}/*TEMPLATE.md`, renamed to this repo's folder spelling (`c-completion-reports`, `d-handoffs`).
3. Point `AGENTS.md` and `README.md` at `docs/` **inside this repo**. Leave the parent workbench in place; do not delete it.

### 1. Monorepo skeleton

1. `pnpm init` at OCC root. `"private": true`, `"type": "module"`, `"packageManager": "pnpm@10.33.0"`.
2. `pnpm-workspace.yaml`:

   ```yaml
   packages:
     - "packages/core"
     - "packages/adapters/*"
     - "packages/mcp-facade"
   ```

3. Root scripts: `"test": "vitest run"`, `"test:watch": "vitest"`, `"typecheck": "pnpm -r typecheck"`, `"build": "pnpm -r build"`.
4. DevDeps (current on 2026-08-19, pin what `pnpm add` resolves): `typescript@7.0.2`, `vitest@4`, `@types/node`.
5. `tsconfig.base.json`: `"strict": true`, `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`, `"target": "ES2023"`, `"verbatimModuleSyntax": true`.
6. Each package: `"type": "module"`, `main`/`types`/`exports` to `dist/`, `tsconfig.json` extending the base. Engines: `"node": ">=22"`.
7. Commit: `chore: scaffold pnpm workspace`.

### 2. Core types + store + registry (TDD)

1. Write `packages/core/test/tasks.test.ts`: create a task, mark running, complete with a `DelegationResult`, cancel unknown id → error. Run, confirm fail.
2. Implement `ids.ts` (`task_<ulid-or-iso-rand>`), `tasks.ts`, `types.ts`.
3. Write `packages/core/test/registry.test.ts`: register fake handle, `get("codex")` works, `get("nope")` throws with the known ids in the message.
4. Implement `registry.ts` + `test/fake-handle.ts` (`FakeAgentHandle` that records prompts and returns a canned `DelegationResult`; `cancel` flips a flag).
5. Export only the public surface from `src/index.ts`.
6. `pnpm --filter @occ/core test` green. Commit: `feat(core): AgentHandle contract and in-memory task store`.

### 3. Codex JSONL parser (no spawn yet)

Parser is a pure function. Fixture the official shapes — do not invent fields.

`parseExecJsonl(text: string): ParsedExec`

```ts
export interface ParsedExec {
  threadId?: string;
  output: string;          // last agent_message.text
  filesChanged: FileChange[];
  usage?: DelegationResult["usage"];
  turnFailed?: string;     // turn.failed error.message
  fatalError?: string;     // type=error except /^Reconnecting\.\.\./
}
```

Rules (from Codex exec JSONL + the 2026-08-19 cheatsheet):

- `thread.started.thread_id` → `threadId`
- `item.completed` + `item.type === "agent_message"` → `output` (last one wins)
- `item.completed` + `item.type === "file_change"` → map `kind`: `add→add`, `update→mod`, `delete→del`
- `turn.completed.usage` → `usage`
- `turn.failed.error.message` → `turnFailed`
- `type === "error"` whose message matches `/^Reconnecting\.\.\./` → ignore
- other `type === "error"` → `fatalError`
- unknown `item.type` / extra fields → ignore

Tests: `test/fixtures/exec-success.jsonl` (thread + command + file_change + agent_message + turn.completed) and `exec-failed.jsonl` (turn.failed). Also a reconnect `error` line must not fail the parse.

Commit: `feat(adapter-codex): parse codex exec JSONL`.

### 4. Codex spawn + handle

`buildCodexExecArgs(opts)` returns `string[]` (program is `codex`, resolved via `CODEX_BIN` or `PATH`):

New session:

```
exec --json --skip-git-repo-check --cd <cwd> --sandbox <mode> --approve-for-me
     [-m <model>] [-o <lastMessagePath>] [--ephemeral if SessionOptions say so]
     -- <brief>
```

Resume:

```
exec resume <sessionId> --json --skip-git-repo-check --cd <cwd> --sandbox <mode>
     --approve-for-me [-m <model>] [-o <lastMessagePath>] -- <brief>
```

Do **not** pass `--dangerously-bypass-approvals-and-sandbox`. Do **not** pass `--full-auto` (removed in 0.147).

`isAvailable()`:

- `codex --version` (sync-or-async spawn). Missing binary → `{ available: false, authenticated: false, detail, }`.
- Do not invent an auth probe that hits the network. If the binary runs, `authenticated: true` unless stderr clearly says login is required. Live smoke will catch a logged-out CLI.

`CodexAgentHandle.prompt`:

1. `realpath` `session.cwd`; reject if not a directory (`invalid_cwd`).
2. Insert task as `running`.
3. Spawn with `cwd: session.cwd`, `env: process.env` plus no extra secrets, `stdio: ['ignore','pipe','pipe']`. Kill the **process group** on `cancel` / timeout (`timeout` → `DelegationError.code = "timeout"`).
4. Parse stdout JSONL. If `-o` file is non-empty and parse `output` is empty, use the file.
5. After exit 0 + no `turnFailed`/`fatalError`: `status: "succeeded"`. Else `agent_failed` with stderr + parse error as `message`, hint = “run `codex login`” when stderr says so.
6. `sessionId` = parsed `threadId` ?? incoming session id.
7. Optional: `git -C cwd diff --stat` only if `filesChanged` is empty **and** git is available. Never fail the delegation because git failed.

Tests use `test/fixtures/fake-codex.mjs` on `PATH` via `CODEX_BIN`. The stub prints a fixture JSONL, writes `-o`, exits 0. A second stub exits 1 with “not logged in”.

Commit: `feat(adapter-codex): AgentHandle over codex exec`.

### 5. MCP façade

`packages/mcp-facade/src/server.ts` builds a FastMCP server (`@prefecthq/fastmcp-ts/server`), registers two tools, `run()` on stdio from `src/stdio.ts`.

**`occ_health`** — `readOnlyHint: true`. Returns `{ ok, agents: [{ id, available, authenticated, detail, version }] }`. Used to verify Claude can see OCC before paying for a Codex turn.

**`delegate_to_codex`** — `destructiveHint: true`, `openWorldHint: true`, `idempotentHint: false`.

Input (Zod 4):

| Field | Type | Notes |
| --- | --- | --- |
| `brief` | string, min 1 | Required. Tool description must tell Claude to write acceptance criteria, not dump the whole chat |
| `cwd` | string, optional | Default: `process.cwd()` of the MCP server (Claude launches us in the workspace) |
| `model` | string, optional | Passed through to `codex exec -m` |
| `sandbox` | enum, default `workspace-write` | |
| `resume_session_id` | string, optional | Codex `thread_id` |
| `timeout_ms` | number, optional, 1_000–1_800_000 | Default 600_000 |

Output: the `DelegationResult` as structured content **and** a compact markdown text block Claude can read without parsing JSON (status, summary, filesChanged, sessionId, error).

Tool description (keep this wording close — it is the UX):

> Delegate an implementation or investigation brief to the local Codex CLI. Use when Claude should plan/review and Codex should do the repo work. Write a self-contained brief: goal, constraints, files in play, definition of done. Returns status, Codex's last message, changed files, and a `sessionId` you can pass as `resume_session_id` to continue the same Codex thread.

Wiring:

```ts
const registry = new AgentRegistry();
registry.register(new CodexAgentHandle());
const store = new InMemoryTaskStore();
```

`delegate_to_codex` → `isAvailable` (fail fast with `not_available` / `not_authenticated`) → `startSession` → `prompt` → persist in store → return.

In-process test: Prefect's `Client.connect(server)` (or official v2 in-memory transport if that's what the installed API exposes — verify at implementation, do not guess). Call `occ_health` and `delegate_to_codex` against `FakeAgentHandle` by injecting the registry. Do **not** spawn real Codex in unit tests.

Bin: `"occ-mcp": "dist/stdio.js"`. Root convenience: `"occ-mcp": "pnpm --filter @occ/mcp-facade exec node dist/stdio.js"` after build, or `tsx src/stdio.ts` in dev.

Commit: `feat(mcp): delegate_to_codex over AgentHandle`.

### 6. Claude Code wiring + docs

1. Add an example `.mcp.json` (or README snippet) — project-scope, no secrets:

   ```json
   {
     "mcpServers": {
       "orbital": {
         "command": "node",
         "args": ["packages/mcp-facade/dist/stdio.js"]
       }
     }
   }
   ```

   Dev alternative: `pnpm exec tsx packages/mcp-facade/src/stdio.ts`. Prefer the built file for Claude so we are not depending on `tsx` being on Claude's PATH.

2. README: replace “early scaffolding” status with the loop. Exact steps: build, `claude mcp add orbital -- node <abs-or-repo>/packages/mcp-facade/dist/stdio.js`, call `occ_health`, then `delegate_to_codex`.
3. `AGENTS.md`: keep AgentHandle rules. Replace “use vendored FastMCP” with “use `@prefecthq/fastmcp-ts` (MCP SDK v2). Study vendored copies; do not depend on them.”
4. Live smoke (ruin-max, not CI): after David approves and code lands, run `occ_health` then a **read-only** `delegate_to_codex` (`sandbox: "read-only"`, brief: “Reply with the word PING and do not change any files.”). Record stdout/result in CR-001. If Codex is logged out, CR is `PARTIAL` with that flag — do not mark the live path tested.

Commit: `docs: Claude Code loop for delegate_to_codex`.

### 7. Completion report

Write `docs/c-completion-reports/CR-001_Core_Handle_Codex_Mcp.md`. Claims require evidence: test command output, `occ_health` payload, live smoke or an explicit “not run / why”.

## Risks & edge cases

| Risk | Mitigation |
| --- | --- |
| Claude Code 2.1.235 refuses a server that still speaks 2025-11-25 | Prefect FastMCP on SDK v2. First live check is `occ_health`, not a paid Codex turn. Fallback: drop FastMCP and use `@modelcontextprotocol/server@2` directly |
| Prefect FastMCP API ≠ Context7 snippets | Verify against the installed package types before writing the server. Do not copy vendored punkpeye `addTool` |
| Codex `--approve-for-me` still blocks on some tools | Surface `agent_failed` with the JSONL/stderr. Do **not** silently upgrade to `--dangerously-bypass-approvals-and-sandbox`. Flag for David if the live smoke cannot complete a write |
| `codex exec` default sandbox is read-only | Always pass `--sandbox` explicitly. Tool default is `workspace-write` |
| JSONL schema drift across Codex minors | Parser ignores unknown fields. Pin a captured fixture from 0.148. Re-capture if `codex --version` changes in CI later |
| Long turns exceed MCP client patience | 10 min default, 30 min cap. Document that Claude should write a tight brief. No job-queue in this IP |
| MCP server `cwd` ≠ the workspace Claude thinks it is | Document that Claude should pass `cwd`. Default `process.cwd()`. Resolve realpath |
| Codex requires a git repo | Always pass `--skip-git-repo-check`. Callers can still point at a git cwd |
| `CODEX_API_KEY` in the inherited env | We do not set it. We also do not strip the user environment — this is a local same-user stdio server. Do not log env |
| Fake “available + authenticated” when Codex is logged out | Acceptable for unit tests. Live smoke is the auth proof. Health detail should include `codex --version` |

## Verification & rollback

**Automated (required before CR-001 `testing: true`):**

```bash
cd a8-orbital-command-centre
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

Expected: all package tests pass; `packages/mcp-facade/dist/stdio.js` exists.

**MCP in-process:** `delegate_to_codex` against `FakeAgentHandle` returns `status: "succeeded"` and the canned summary.

**Parser:** success fixture → `output` matches last `agent_message`; `filesChanged` mapped; reconnect error ignored. Failed fixture → `turnFailed` set.

**Live (ruin-max, evidence in CR, not a merge gate):**

```bash
node packages/mcp-facade/dist/stdio.js   # only via MCP client
# In Claude Code: occ_health, then delegate_to_codex with sandbox=read-only and brief "Reply with PING. Change no files."
```

Expected: `available: true`, result `status: "succeeded"`, `output` contains `PING`, `filesChanged` empty.

**Rollback:** this IP only adds files. Revert the commits. Displaced parent docs stay in the parent workbench; nothing is deleted. If a `.mcp.json` was added to a workspace, remove that server entry (`claude mcp remove orbital`).

## Decisions needed from David

1. **First adapter = Codex via `codex exec`.** Recommended. Alternatives: Grok `-p` (thinner CLI, wrong offload), Cursor `agent acp` (good second adapter), Codex ACP (`codex-acp` vendored) — same handle later, heavier now.
2. **MCP library = `@prefecthq/fastmcp-ts` (SDK v2).** Recommended. Alternative: official `@modelcontextprotocol/server@2` with no FastMCP. Reject: vendored/punkpeye FastMCP.
3. **Docs canonical = OCC repo `docs/`.** Recommended. Parent workbench remains a scratch/vendored shelf.
4. **Isolation = inherit `cwd` + Codex `--sandbox`.** Recommended. No OCC worktrees in this IP.
5. **Default permission = `--sandbox workspace-write --approve-for-me`.** Recommended. Not yolo. `danger-full-access` is an explicit tool argument only.
6. **Package scope = `@occ/*`.** Recommended. Alternative: `@orbital/*` / `@abliter8/*` if you want the npm org reserved now (we are not publishing).
7. **TypeScript 7.0.2 + pnpm 10 + Node ≥22.** Recommended current stable. Floor 22 because Prefect FastMCP requires it; ruin-max is already 26.

On approval, record which options were taken (or “all recommended”) in the frontmatter `status` line.

## Grounding appendix (2026-08-19)

Inspected:

- `/Users/roo/Developer/a8-agent-client-protocol/a8-orbital-command-centre` — `README.md`, `AGENTS.md`, `assets/`, `.gitignore` (`vendored/` ignored). Origin `github.com/abliter8-ai/orbital-command-centre`.
- Parent workbench: `docs/starting-overview.md`, `docs/source-refs/{cursor-acp,grok-build}.md`, empty plan folders; `vendored/` (ACP SDK, `codex-acp` 1.5.0, `claude-agent-acp` 0.70.0, `cursor-agent-a2a` 2.1.0, `fastmcp-ts`, `a2a-adapter`, `cc-multi-cli-plugin`, `openab`, registry). Parent has no `.git`.

Live-verified on ruin-max:

- `node` 26.7.0 · `pnpm` 10.33.0 · `typescript@latest` 7.0.2 · `vitest` 4.1.11 · `zod` 4.4.3
- `codex` 0.148.0 at `/opt/homebrew/bin/codex` — `exec --json`, `-o`, `--output-schema`, `--sandbox`, `--approve-for-me`, `--ephemeral`, `--cd`, `--skip-git-repo-check`. No `--full-auto`.
- `grok` 1.0.5 — `-p`, `--output-format json|streaming-json`, `--always-approve`, `grok agent stdio`
- `claude` 2.1.235 — MCP 2026-07-28, `server/discover`, no pre-2026-07-28 fallback
- Cursor CLI present at `~/.local/bin/agent` (version not read: login keychain locked)
- npm: `fastmcp` 4.16.5 (punkpeye, SDK v1) · `@prefecthq/fastmcp-ts` 1.5.1 (SDK v2, optional peers) · `@modelcontextprotocol/sdk` 1.30.0 · `@modelcontextprotocol/server` 2.0.0 · `@agentclientprotocol/sdk` 1.3.0

Sources: Context7 (`/prefecthq/fastmcp-ts`, `/punkpeye/fastmcp`, `/modelcontextprotocol/typescript-sdk`); [MCP 2026-07-28 RC](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/); [Claude rollout note](https://claude.com/blog/bringing-mcp-2026-07-28-to-claude) (“support rolling out”); [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode); Codex exec JSONL field list cross-checked against the public cheatsheet shapes (parser must still be fixture-tested against 0.148 on this box).
