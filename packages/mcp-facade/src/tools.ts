import { summariseOutput } from "@occ/adapter-kit";
import type {
  GrokImagineOptions,
  GrokVideoOptions,
  GrokXSearchOptions,
} from "@occ/adapter-grok";
import type { CodexReviewOptions, CodexReviewTarget } from "@occ/adapter-codex";
import {
  applyResearchAllowRules,
  checkResearchPermissions,
  type AgyResearchOptions,
} from "@occ/adapter-antigravity";
import type {
  AgentHandle,
  AgentId,
  AgentRegistry,
  DelegationResult,
  InMemoryTaskStore,
  ReasoningEffort,
  SandboxMode,
  Session,
  TaskStatus,
} from "@occ/core";
import {
  catalogAgeMs,
  catalogPath,
  isCatalogStale,
  type AgentModelCatalog,
  type ModelCatalog,
} from "./catalog.js";

export const DELEGATE_BRIEF_DESCRIPTION =
  "Self-contained brief: goal, constraints, files in play, definition of done.";

const CODEX_INTRO = `Delegate an implementation or investigation brief to the local Codex CLI (codex exec). Use when Claude should plan/review and Codex should do the repo work. Write a self-contained brief: goal, constraints, files in play, definition of done. Returns status, last message, changed files, and a sessionId for resume_session_id.`;
const CODEX_MODEL_CAUTIONS = `Do not use gpt-5.1-codex or gpt-5.3-codex on ChatGPT auth. gpt-5.4 / gpt-5.4-mini retire 2026-08-31.`;
const CODEX_EFFORT = `Reasoning effort (optional, maps to model_reasoning_effort): low, medium (config default), high, xhigh, max. Omit to use ~/.codex/config.toml.`;

const CURSOR_INTRO = `Delegate an implementation or investigation brief to the local Cursor CLI (\`cursor-agent -p\`). Never spawn \`agent\` — that name is Grok on some PATHs. Use when Claude should plan/review and Cursor should do the repo work. Write a self-contained brief: goal, constraints, files in play, definition of done. Returns status, last message, changed files, and a sessionId for resume_session_id.`;
const CURSOR_MODEL_CAUTIONS = `Parameterized form: claude-opus-4-8[context=1m,effort=high,fast=false]. There is no separate effort field — encode effort in the model slug. Do not pass Codex-config slugs blindly; prefer entries from this catalog.`;

const GROK_INTRO = `Delegate an implementation, investigation, live X/web, or Imagine brief to the local Grok CLI (\`grok -p --output-format json\`). Never spawn the binary named \`agent\` when you meant Cursor — \`agent\` is Grok on PATHs that include ~/.grok/bin. Use when the user asked for Grok, or the brief needs Grok-native tools (web_search/web_fetch, X search, Imagine). Write a self-contained brief: goal, constraints, files in play, definition of done. Name native tools in the brief; they are not OCC tools. Returns status, last message, sessionId for resume_session_id.`;
const GROK_MODEL_CAUTIONS = `Local aliases (dsv4-*, glm-*, minimax-*) are valid only when they appear in this catalog. Do not pass Codex or Cursor slugs.`;
const GROK_EFFORT = `Reasoning effort (optional, maps to --effort): low, medium, high, xhigh, max. Omit for Grok default.`;

const ANTIGRAVITY_INTRO = `Delegate an implementation or investigation brief to the local Antigravity CLI (\`agy -p --output-format json\`). Antigravity is Google's agent CLI (successor surface to Gemini CLI). Never spawn \`gemini\` — that is a different binary. Write a self-contained brief. Returns status, last message, sessionId (conversation_id) for resume_session_id.`;
const ANTIGRAVITY_MODEL_CAUTIONS = `Unknown --model is a hard ERROR — pass only slugs from this catalog. Do not pass Codex or Grok slugs.`;
const ANTIGRAVITY_EFFORT = `Reasoning effort (optional, --effort): low, medium, high. OCC xhigh/max map to high. Native web (\`google_search\`, \`read_url\`, \`execute_url\`) stays inside agy — name it in the brief and pre-allow in ~/.gemini/antigravity-cli/settings.json, or use sandbox danger-full-access.`;

const CLAUDE_INTRO = `Delegate a brief to a fresh headless Claude Code (\`claude -p\`). This is the flip: when the orchestrator is Cursor, Codex, or Grok, this is how they borrow Claude; when the orchestrator is Claude Code, this buys a clean-context second opinion or parallel worker. The child runs isolated from your MCP servers. Write a self-contained brief: goal, constraints, files in play, definition of done. Returns status, last message, changed files, cost, and a sessionId for resume_session_id.`;
const CLAUDE_MODEL_CAUTIONS = `Model aliases sonnet|opus work; the haiku alias is broken headless (silently runs sonnet — anthropics/claude-code#39701) so pass the full ID claude-haiku-4-5. There is no effort field — reasoning depth is baked into the model choice. Delegation spends the account's own usage: on claude.ai subscription auth the reported cost is the CLI's API-equivalent meter (a proxy for rate-limit burn, not a charge); on API-key auth it is literal. The summary reports the model that actually ran — trust it over the requested slug.`;

export function formatModelSection(entry: AgentModelCatalog): string {
  const fetched = entry.fetchedAt ?? "never";
  const cli = entry.cliVersion ? `, CLI ${entry.cliVersion}` : "";
  const fallback =
    entry.source === "static"
      ? " Built-in fallback — run scripts/update-models.sh (or .ps1) for the live catalog."
      : "";
  const list = entry.models.join(", ");
  const def = entry.defaultModel ? ` Default: ${entry.defaultModel}.` : "";
  return `Models (catalog ${entry.source}, fetched ${fetched}${cli}): ${list}.${def}${fallback}`;
}

export function buildDelegateDescriptions(catalog: ModelCatalog): Record<AgentId, string> {
  return {
    codex: `${CODEX_INTRO}\n\n${formatModelSection(catalog.agents.codex)} ${CODEX_MODEL_CAUTIONS}\n\n${CODEX_EFFORT}`,
    cursor: `${CURSOR_INTRO}\n\n${formatModelSection(catalog.agents.cursor)} ${CURSOR_MODEL_CAUTIONS}`,
    grok: `${GROK_INTRO}\n\n${formatModelSection(catalog.agents.grok)} ${GROK_MODEL_CAUTIONS}\n\n${GROK_EFFORT}`,
    antigravity: `${ANTIGRAVITY_INTRO}\n\n${formatModelSection(catalog.agents.antigravity)} ${ANTIGRAVITY_MODEL_CAUTIONS}\n\n${ANTIGRAVITY_EFFORT}`,
    claude: `${CLAUDE_INTRO}\n\n${formatModelSection(catalog.agents.claude)} ${CLAUDE_MODEL_CAUTIONS}`,
  };
}

export interface DelegateInput {
  brief: string;
  cwd?: string;
  model?: string;
  sandbox?: SandboxMode;
  resume_session_id?: string;
  timeout_ms?: number;
  effort?: ReasoningEffort;
  /** Absolute image paths for the agent to look at. Only Codex accepts image input today; other adapters ignore this. */
  images?: string[];
}

export type DelegateToCodexInput = DelegateInput;

const HINTS: Record<AgentId, { missing: string; unauthenticated: string }> = {
  codex: {
    missing: "Install Codex and ensure it is on PATH, or set CODEX_BIN.",
    unauthenticated: "Run `codex login` and retry occ_health.",
  },
  cursor: {
    missing: "Install the Cursor CLI (`cursor-agent` on PATH) or set CURSOR_BIN. Do not use `agent` — that is Grok on some PATHs.",
    unauthenticated:
      "Run `AGENT_CLI_CREDENTIAL_STORE=file cursor-agent login`, or unlock the macOS login keychain. OCC sets AGENT_CLI_CREDENTIAL_STORE=file for spawned cursor-agent processes.",
  },
  grok: {
    missing: "Install the Grok CLI (`grok` on PATH) or set GROK_BIN. Do not use `agent` as a Cursor binary.",
    unauthenticated: "Run `grok login` and retry occ_health.",
  },
  antigravity: {
    missing: "Install the Antigravity CLI (`agy` on PATH) or set AGY_BIN. Do not use `gemini`.",
    unauthenticated:
      "Run interactive `agy` once (cached OAuth), or set modelProvider=gemini in ~/.gemini/antigravity-cli/settings.json plus GEMINI_API_KEY.",
  },
  claude: {
    missing: "Install Claude Code (`claude` on PATH) or set CLAUDE_BIN.",
    unauthenticated: "Run `claude auth login` and retry occ_health.",
  },
};

export async function runHealth(registry: AgentRegistry): Promise<{
  ok: boolean;
  agents: Array<{
    id: string;
    available: boolean;
    authenticated: boolean;
    detail: string;
    version?: string;
  }>;
}> {
  const agents = [];
  for (const handle of registry.list()) {
    const availability = await handle.isAvailable();
    agents.push({
      id: handle.agentId,
      available: availability.available,
      authenticated: availability.authenticated,
      detail: availability.detail,
      version: availability.version,
    });
  }
  return {
    ok: agents.some((agent) => agent.available),
    agents,
  };
}

export async function runDelegate(
  registry: AgentRegistry,
  store: InMemoryTaskStore,
  agentId: AgentId,
  input: DelegateInput,
): Promise<DelegationResult> {
  const handle = registry.get(agentId);
  const availability = await handle.isAvailable();
  const cwd = input.cwd ?? process.cwd();
  const hints = HINTS[agentId];

  if (!availability.available || !availability.authenticated) {
    return {
      taskId: "task_unavailable",
      sessionId: input.resume_session_id ?? "none",
      agentId,
      status: "failed",
      cwd,
      summary: availability.detail,
      output: "",
      filesChanged: [],
      durationMs: 0,
      error: {
        code: availability.available ? "not_authenticated" : "not_available",
        message: availability.detail,
        hint: availability.available ? hints.unauthenticated : hints.missing,
      },
    };
  }

  const session = await handle.startSession({
    cwd,
    resumeSessionId: input.resume_session_id,
    model: input.model,
  });
  const result = await handle.prompt(session, {
    brief: input.brief,
    sandbox: input.sandbox,
    timeoutMs: input.timeout_ms,
    effort: input.effort,
    images: input.images,
  });
  store.record(result, {
    brief: input.brief,
    sandbox: input.sandbox,
    timeoutMs: input.timeout_ms,
    effort: input.effort,
  });
  return result;
}

export function runDelegateToCodex(
  registry: AgentRegistry,
  store: InMemoryTaskStore,
  input: DelegateInput,
): Promise<DelegationResult> {
  return runDelegate(registry, store, "codex", input);
}

export function runDelegateToCursor(
  registry: AgentRegistry,
  store: InMemoryTaskStore,
  input: DelegateInput,
): Promise<DelegationResult> {
  return runDelegate(registry, store, "cursor", input);
}

export function runDelegateToGrok(
  registry: AgentRegistry,
  store: InMemoryTaskStore,
  input: DelegateInput,
): Promise<DelegationResult> {
  return runDelegate(registry, store, "grok", input);
}

export function runDelegateToAntigravity(
  registry: AgentRegistry,
  store: InMemoryTaskStore,
  input: DelegateInput,
): Promise<DelegationResult> {
  return runDelegate(registry, store, "antigravity", input);
}

export interface TaskListEntry {
  taskId: string;
  agentId: AgentId;
  sessionId: string;
  status: TaskStatus;
  startedAt: string;
  finishedAt?: string;
  brief: string;
  sandbox?: SandboxMode;
  summary?: string;
}

export function runListTasks(
  store: InMemoryTaskStore,
  filter?: { status?: TaskStatus[] },
): { tasks: TaskListEntry[] } {
  return {
    tasks: store.list({ status: filter?.status }).map((record) => ({
      taskId: record.taskId,
      agentId: record.agentId,
      sessionId: record.sessionId,
      status: record.status,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      brief: summariseOutput(record.request.brief, 160),
      sandbox: record.request.sandbox,
      summary: record.result ? summariseOutput(record.result.summary, 300) : undefined,
    })),
  };
}

export interface CancelResult {
  ok: boolean;
  taskId: string;
  agentId?: AgentId;
  status?: TaskStatus;
  error?: {
    code: "unknown_task" | "not_running";
    message: string;
  };
}

export async function runCancel(
  registry: AgentRegistry,
  store: InMemoryTaskStore,
  taskId: string,
): Promise<CancelResult> {
  const record = store.get(taskId);
  if (!record) {
    return {
      ok: false,
      taskId,
      error: {
        code: "unknown_task",
        message: `Unknown task id: ${taskId}. Get running task ids from occ_tasks. The store is in-memory and resets when the MCP server restarts.`,
      },
    };
  }
  if (record.status !== "running" && record.status !== "queued") {
    return {
      ok: false,
      taskId,
      agentId: record.agentId,
      status: record.status,
      error: {
        code: "not_running",
        message: `Task is ${record.status}; only queued or running tasks can be cancelled.`,
      },
    };
  }
  const handle = registry.get(record.agentId);
  await handle.cancel(taskId);
  // Real handles mark the store themselves; do it here too so the state is
  // consistent even if the handle raced us to completion.
  const after = store.get(taskId);
  if (after && (after.status === "running" || after.status === "queued")) {
    store.cancel(taskId);
  }
  return { ok: true, taskId, agentId: record.agentId, status: "cancelled" };
}

export function runModels(
  catalog: ModelCatalog,
  path: string = catalogPath(),
): {
  path: string;
  updatedAt: string | null;
  ageMs: number | null;
  stale: boolean;
  agents: AgentModelCatalog[];
} {
  return {
    path,
    updatedAt: catalog.updatedAt,
    ageMs: catalogAgeMs(catalog),
    stale: isCatalogStale(catalog),
    agents: [catalog.agents.codex, catalog.agents.cursor, catalog.agents.grok, catalog.agents.antigravity],
  };
}

/**
 * The Grok handle's native tools (X search, Imagine) beyond the plain
 * AgentHandle contract. Structural, so tests can substitute a fake.
 */
export interface GrokNativeHandle extends AgentHandle {
  xSearch(opts: GrokXSearchOptions): Promise<DelegationResult>;
  imagine(opts: GrokImagineOptions): Promise<DelegationResult>;
  animateVideo(opts: GrokVideoOptions): Promise<DelegationResult>;
}

export function isGrokNativeHandle(handle: AgentHandle): handle is GrokNativeHandle {
  const candidate = handle as Partial<GrokNativeHandle>;
  return (
    handle.agentId === "grok" &&
    typeof candidate.xSearch === "function" &&
    typeof candidate.imagine === "function" &&
    typeof candidate.animateVideo === "function"
  );
}

async function runGrokNative(
  registry: AgentRegistry,
  store: InMemoryTaskStore,
  briefForStore: string,
  fn: (handle: GrokNativeHandle) => Promise<DelegationResult>,
): Promise<DelegationResult> {
  const handle = registry.get("grok");
  const availability = await handle.isAvailable();
  if (!availability.available || !availability.authenticated) {
    return {
      taskId: "task_unavailable",
      sessionId: "none",
      agentId: "grok",
      status: "failed",
      cwd: process.cwd(),
      summary: availability.detail,
      output: "",
      filesChanged: [],
      durationMs: 0,
      error: {
        code: availability.available ? "not_authenticated" : "not_available",
        message: availability.detail,
        hint: availability.available ? HINTS.grok.unauthenticated : HINTS.grok.missing,
      },
    };
  }
  if (!isGrokNativeHandle(handle)) {
    return {
      taskId: "task_unavailable",
      sessionId: "none",
      agentId: "grok",
      status: "failed",
      cwd: process.cwd(),
      summary: "The registered Grok handle does not expose native tools.",
      output: "",
      filesChanged: [],
      durationMs: 0,
      error: {
        code: "agent_failed",
        message: "The registered Grok handle does not expose native tools.",
        hint: "Update @occ/adapter-grok to a build with xSearch/imagine/animateVideo.",
      },
    };
  }
  const result = await fn(handle);
  // The handle writes its own task record when it shares this store; record
  // again so a detached handle store still leaves the task visible here.
  store.record(result, { brief: briefForStore });
  return result;
}

export function runGrokXSearch(
  registry: AgentRegistry,
  store: InMemoryTaskStore,
  input: GrokXSearchOptions,
): Promise<DelegationResult> {
  return runGrokNative(registry, store, `X search: ${input.query}`, (handle) =>
    handle.xSearch(input),
  );
}

export function runGrokImagine(
  registry: AgentRegistry,
  store: InMemoryTaskStore,
  input: GrokImagineOptions,
): Promise<DelegationResult> {
  return runGrokNative(registry, store, `Imagine: ${input.prompt}`, (handle) =>
    handle.imagine(input),
  );
}

export function runGrokVideo(
  registry: AgentRegistry,
  store: InMemoryTaskStore,
  input: GrokVideoOptions,
): Promise<DelegationResult> {
  return runGrokNative(registry, store, `Video from ${input.sourceImage}`, (handle) =>
    handle.animateVideo(input),
  );
}

// ---- Codex review ----------------------------------------------------------

export interface CodexReviewHandle extends AgentHandle {
  review(session: Session, opts: CodexReviewOptions): Promise<DelegationResult>;
}

export function isCodexReviewHandle(handle: AgentHandle): handle is CodexReviewHandle {
  return (
    handle.agentId === "codex" &&
    typeof (handle as Partial<CodexReviewHandle>).review === "function"
  );
}

function unavailableResult(agentId: AgentId, detail: string, hint: string): DelegationResult {
  return {
    taskId: "task_unavailable",
    sessionId: "none",
    agentId,
    status: "failed",
    cwd: process.cwd(),
    summary: detail,
    output: "",
    filesChanged: [],
    durationMs: 0,
    error: { code: "agent_failed", message: detail, hint },
  };
}

export async function runCodexReview(
  registry: AgentRegistry,
  store: InMemoryTaskStore,
  input: CodexReviewOptions & { cwd: string },
): Promise<DelegationResult> {
  const handle = registry.get("codex");
  const availability = await handle.isAvailable();
  if (!availability.available || !availability.authenticated) {
    return {
      ...unavailableResult(
        "codex",
        availability.detail,
        availability.available ? HINTS.codex.unauthenticated : HINTS.codex.missing,
      ),
      error: {
        code: availability.available ? "not_authenticated" : "not_available",
        message: availability.detail,
        hint: availability.available ? HINTS.codex.unauthenticated : HINTS.codex.missing,
      },
    };
  }
  if (!isCodexReviewHandle(handle)) {
    return unavailableResult(
      "codex",
      "The registered Codex handle does not expose review.",
      "Update @occ/adapter-codex to a build with review().",
    );
  }
  const session = await handle.startSession({ cwd: input.cwd, model: input.model });
  const result = await handle.review(session, input);
  store.record(result, { brief: `Review: ${input.prompt ?? input.target.kind}` });
  return result;
}

// ---- Antigravity research ----------------------------------------------------

export interface AgyResearchHandle extends AgentHandle {
  research(session: Session, opts: AgyResearchOptions): Promise<DelegationResult>;
}

export function isAgyResearchHandle(handle: AgentHandle): handle is AgyResearchHandle {
  return (
    handle.agentId === "antigravity" &&
    typeof (handle as Partial<AgyResearchHandle>).research === "function"
  );
}

export type AgyResearchPreflight = "check" | "fix" | "skip";

export interface AgyResearchInput extends AgyResearchOptions {
  cwd: string;
  model?: string;
  preflight?: AgyResearchPreflight;
}

export async function runAgyResearch(
  registry: AgentRegistry,
  store: InMemoryTaskStore,
  input: AgyResearchInput,
): Promise<DelegationResult> {
  const handle = registry.get("antigravity");
  const availability = await handle.isAvailable();
  if (!availability.available || !availability.authenticated) {
    return {
      ...unavailableResult(
        "antigravity",
        availability.detail,
        availability.available ? HINTS.antigravity.unauthenticated : HINTS.antigravity.missing,
      ),
      error: {
        code: availability.available ? "not_authenticated" : "not_available",
        message: availability.detail,
        hint: availability.available
          ? HINTS.antigravity.unauthenticated
          : HINTS.antigravity.missing,
      },
    };
  }
  if (!isAgyResearchHandle(handle)) {
    return unavailableResult(
      "antigravity",
      "The registered Antigravity handle does not expose research.",
      "Update @occ/adapter-antigravity to a build with research().",
    );
  }

  const preflight = input.preflight ?? "check";
  if (preflight !== "skip") {
    const pre = await checkResearchPermissions();
    if (pre.missing.length > 0) {
      if (preflight === "check") {
        return {
          ...unavailableResult(
            "antigravity",
            `Web tools would be soft-denied: ${pre.missing.join(", ")} not in permissions.allow.`,
            `Re-run with preflight "fix" to add them (backup made), or add to ${pre.settingsPath}: "permissions": { "allow": [${pre.missing.map((r) => `"${r}"`).join(", ")}] }`,
          ),
          error: {
            code: "not_authenticated",
            message: `Antigravity web tools would be soft-denied headlessly: missing allow rules ${pre.missing.join(", ")}.`,
            hint: `Re-run with preflight "fix" to add them automatically (a timestamped backup is written), or add them to permissions.allow in ${pre.settingsPath} yourself.`,
          },
        };
      }
      // preflight === "fix"
      await applyResearchAllowRules(pre.settingsPath);
    }
  }

  const session = await handle.startSession({ cwd: input.cwd, model: input.model });
  const result = await handle.research(session, input);
  store.record(result, { brief: `Research: ${input.question}` });
  return result;
}
