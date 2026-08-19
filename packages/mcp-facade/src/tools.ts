import type {
  AgentRegistry,
  DelegationResult,
  InMemoryTaskStore,
  SandboxMode,
} from "@occ/core";

export const DELEGATE_TO_CODEX_DESCRIPTION = `Delegate an implementation or investigation brief to the local Codex CLI. Use when Claude should plan/review and Codex should do the repo work. Write a self-contained brief: goal, constraints, files in play, definition of done. Returns status, Codex's last message, changed files, and a sessionId you can pass as resume_session_id to continue the same Codex thread.`;

export interface DelegateToCodexInput {
  brief: string;
  cwd?: string;
  model?: string;
  sandbox?: SandboxMode;
  resume_session_id?: string;
  timeout_ms?: number;
}

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

export async function runDelegateToCodex(
  registry: AgentRegistry,
  store: InMemoryTaskStore,
  input: DelegateToCodexInput,
): Promise<DelegationResult> {
  const handle = registry.get("codex");
  const availability = await handle.isAvailable();
  const cwd = input.cwd ?? process.cwd();

  if (!availability.available || !availability.authenticated) {
    const result: DelegationResult = {
      taskId: "task_unavailable",
      sessionId: input.resume_session_id ?? "none",
      agentId: "codex",
      status: "failed",
      cwd,
      summary: availability.detail,
      output: "",
      filesChanged: [],
      durationMs: 0,
      error: {
        code: availability.available ? "not_authenticated" : "not_available",
        message: availability.detail,
        hint: availability.available
          ? "Run `codex login` and retry occ_health."
          : "Install Codex and ensure it is on PATH, or set CODEX_BIN.",
      },
    };
    return result;
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
