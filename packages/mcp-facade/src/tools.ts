import type {
  AgentId,
  AgentRegistry,
  DelegationResult,
  InMemoryTaskStore,
  SandboxMode,
} from "@occ/core";

export const DELEGATE_BRIEF_DESCRIPTION =
  "Self-contained brief: goal, constraints, files in play, definition of done.";

export const DELEGATE_TO_CODEX_DESCRIPTION = `Delegate an implementation or investigation brief to the local Codex CLI. Use when Claude should plan/review and Codex should do the repo work. Write a self-contained brief: goal, constraints, files in play, definition of done. Returns status, Codex's last message, changed files, and a sessionId you can pass as resume_session_id to continue the same Codex thread.`;

export const DELEGATE_TO_CURSOR_DESCRIPTION = `Delegate an implementation or investigation brief to the local Cursor agent CLI (\`agent -p\`). Use when Claude should plan/review and Cursor should do the repo work. Write a self-contained brief: goal, constraints, files in play, definition of done. Returns status, Cursor's last message, changed files, and a sessionId you can pass as resume_session_id.`;

export interface DelegateInput {
  brief: string;
  cwd?: string;
  model?: string;
  sandbox?: SandboxMode;
  resume_session_id?: string;
  timeout_ms?: number;
}

export type DelegateToCodexInput = DelegateInput;

const HINTS: Record<AgentId, { missing: string; unauthenticated: string }> = {
  codex: {
    missing: "Install Codex and ensure it is on PATH, or set CODEX_BIN.",
    unauthenticated: "Run `codex login` and retry occ_health.",
  },
  cursor: {
    missing: "Install the Cursor agent CLI (`agent`) or set CURSOR_BIN.",
    unauthenticated:
      "Run `agent login`, or unlock the macOS login keychain. OCC sets AGENT_CLI_CREDENTIAL_STORE=file for spawned agent processes.",
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
  });
  store.record(result, {
    brief: input.brief,
    sandbox: input.sandbox,
    timeoutMs: input.timeout_ms,
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
