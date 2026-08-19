import type {
  AgentId,
  AgentRegistry,
  DelegationResult,
  InMemoryTaskStore,
  ReasoningEffort,
  SandboxMode,
} from "@occ/core";

export const DELEGATE_BRIEF_DESCRIPTION =
  "Self-contained brief: goal, constraints, files in play, definition of done.";

export const DELEGATE_TO_CODEX_DESCRIPTION = `Delegate an implementation or investigation brief to the local Codex CLI (codex exec). Use when Claude should plan/review and Codex should do the repo work. Write a self-contained brief: goal, constraints, files in play, definition of done. Returns status, last message, changed files, and a sessionId for resume_session_id.

Models (Codex CLI 0.148+, ChatGPT login): gpt-5.6-sol (flagship), gpt-5.6-terra (everyday), gpt-5.6-luna (fast/cheap, current ~/.codex default), gpt-5.6 (alias → sol), gpt-5.5 (previous gen). Do not use gpt-5.1-codex or gpt-5.3-codex on ChatGPT auth. gpt-5.4 / gpt-5.4-mini retire 2026-08-31.

Reasoning effort (optional, maps to model_reasoning_effort): low, medium (config default), high, xhigh, max. Omit to use ~/.codex/config.toml.`;

export const DELEGATE_TO_CURSOR_DESCRIPTION = `Delegate an implementation or investigation brief to the local Cursor CLI (\`cursor-agent -p\`). Never spawn \`agent\` — that name is Grok on some PATHs. Use when Claude should plan/review and Cursor should do the repo work. Write a self-contained brief: goal, constraints, files in play, definition of done. Returns status, last message, changed files, and a sessionId for resume_session_id.

Models (headless --model, CLI 2026.08.11+): omit or \`auto\` (Cursor default). Documented slugs: gpt-5, sonnet-4-thinking. Parameterized: claude-opus-4-8[context=1m,effort=high,fast=false]. Do not pass Codex slugs (gpt-5.6-luna/terra/sol). Do not invent bracketed ACP modelIds from the desktop. There is no separate effort field — encode effort in the model slug. Catalog listing (\`cursor-agent models\`) requires CURSOR_API_KEY; OAuth-only login can still run -p.`;

export const DELEGATE_TO_GROK_DESCRIPTION = `Delegate an implementation, investigation, live X/web, or Imagine brief to the local Grok CLI (\`grok -p --output-format json\`). Never spawn the binary named \`agent\` when you meant Cursor — \`agent\` is Grok on PATHs that include ~/.grok/bin. Use when the user asked for Grok, or the brief needs Grok-native tools (web_search/web_fetch, X search, Imagine). Write a self-contained brief: goal, constraints, files in play, definition of done. Name native tools in the brief; they are not OCC tools. Returns status, last message, sessionId for resume_session_id.

Models (CLI 1.0.5+, grok.com login): omit for grok-4.6 (CLI default). grok-4.5 is previous gen. Local aliases (dsv4-*, glm-5-2, minimax-m3, …) only if occ_health / \`grok models\` listed them this session. Do not pass Codex slugs (gpt-5.6-luna/terra/sol) or Cursor slugs (auto, gpt-5, sonnet-4-thinking).

Reasoning effort (optional, maps to --effort): low, medium, high, xhigh, max. Omit for Grok default.`;

export const DELEGATE_TO_ANTIGRAVITY_DESCRIPTION = `Delegate an implementation or investigation brief to the local Antigravity CLI (\`agy -p --output-format json\`). Antigravity is Google's agent CLI (successor surface to Gemini CLI). Never spawn \`gemini\` — that is a different binary. Write a self-contained brief. Returns status, last message, sessionId (conversation_id) for resume_session_id.

Models (CLI 1.1.15, from \`agy models\`): gemini-3.7-flash-high|medium|low, gemini-3.6-flash-*, gemini-3.5-flash-*, gemini-3.1-pro-high|low, claude-sonnet-4-6, claude-opus-4-6-thinking, gpt-oss-120b-medium. Unknown --model is a hard ERROR. Do not pass Codex or Grok slugs.

Reasoning effort (optional, --effort): low, medium, high. OCC xhigh/max map to high. Native web (\`google_search\`, \`read_url\`, \`execute_url\`) stays inside agy — name it in the brief and pre-allow in ~/.gemini/antigravity-cli/settings.json, or use sandbox danger-full-access.`;

export interface DelegateInput {
  brief: string;
  cwd?: string;
  model?: string;
  sandbox?: SandboxMode;
  resume_session_id?: string;
  timeout_ms?: number;
  effort?: ReasoningEffort;
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
