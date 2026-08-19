import { clampTimeout, resolveCwd, runChild, summariseOutput, validateCwd } from "@occ/adapter-kit";
import {
  InMemoryTaskStore,
  isPendingSessionId,
  newPendingSessionId,
  type AgentCapabilities,
  type AgentHandle,
  type AgentId,
  type Availability,
  type DelegationError,
  type DelegationResult,
  type PromptRequest,
  type Session,
  type SessionOptions,
} from "@occ/core";
import { probeCursorAvailability } from "./availability.js";
import { normalizeHeadlessOutcome } from "./parse-headless.js";
import {
  DEFAULT_SANDBOX,
  buildHeadlessArgs,
  cursorSpawnEnv,
  outputFormatForSandbox,
  resolveCursorBin,
} from "./spawn-args.js";

export class CursorAgentHandle implements AgentHandle {
  readonly agentId: AgentId = "cursor";
  readonly displayName = "Cursor";

  private readonly store: InMemoryTaskStore;
  private readonly inflight = new Map<string, AbortController>();
  private readonly sessionModels = new Map<string, string>();

  constructor(store?: InMemoryTaskStore) {
    this.store = store ?? new InMemoryTaskStore();
  }

  capabilities(): AgentCapabilities {
    return {
      streaming: false,
      resume: true,
      cancel: true,
      sandboxModes: ["read-only", "workspace-write", "danger-full-access"],
    };
  }

  isAvailable(): Promise<Availability> {
    return probeCursorAvailability();
  }

  async startSession(opts: SessionOptions): Promise<Session> {
    const cwd = await resolveCwd(opts.cwd);
    const session: Session = {
      sessionId: opts.resumeSessionId ?? newPendingSessionId(),
      agentId: this.agentId,
      cwd,
      createdAt: new Date().toISOString(),
    };
    if (opts.model) {
      this.sessionModels.set(session.sessionId, opts.model);
    }
    return session;
  }

  async prompt(session: Session, request: PromptRequest): Promise<DelegationResult> {
    const started = Date.now();
    const task = this.store.create({
      sessionId: session.sessionId,
      agentId: this.agentId,
      request,
    });
    this.store.markRunning(task.taskId);

    const cwdCheck = await validateCwd(session.cwd);
    if (!cwdCheck.ok) {
      const result = this.fail(task.taskId, session, started, {
        code: "invalid_cwd",
        message: cwdCheck.message,
        hint: "Pass an existing directory as cwd.",
      });
      this.store.complete(task.taskId, result);
      return result;
    }

    const sandbox = request.sandbox ?? DEFAULT_SANDBOX;
    const format = outputFormatForSandbox(sandbox);
    const controller = new AbortController();
    this.inflight.set(task.taskId, controller);

    const args = buildHeadlessArgs({
      cwd: cwdCheck.cwd,
      sandbox,
      model: this.sessionModels.get(session.sessionId),
      resumeSessionId: session.sessionId,
    });

    try {
      const ran = await runChild({
        bin: resolveCursorBin(),
        args,
        cwd: cwdCheck.cwd,
        timeoutMs: clampTimeout(request.timeoutMs),
        stdin: request.brief.endsWith("\n") ? request.brief : `${request.brief}\n`,
        env: cursorSpawnEnv(),
        signal: controller.signal,
      });

      if (ran.spawnError) {
        const result = this.fail(task.taskId, session, started, {
          code: "spawn_failed",
          message: ran.spawnError,
          hint: "Install the Cursor CLI (`cursor-agent` on PATH) or set CURSOR_BIN.",
        });
        this.store.complete(task.taskId, result);
        return result;
      }

      if (ran.cancelled) {
        const result = this.fail(task.taskId, session, started, {
          code: "cancelled",
          message: "Delegation cancelled.",
        });
        result.status = "cancelled";
        this.store.complete(task.taskId, result);
        return result;
      }

      if (ran.timedOut) {
        const result = this.fail(task.taskId, session, started, {
          code: "timeout",
          message: `Cursor exceeded timeout of ${clampTimeout(request.timeoutMs)}ms.`,
          hint: "Tighten the brief or raise timeout_ms (max 1800000).",
        });
        this.store.complete(task.taskId, result);
        return result;
      }

      const parsed = normalizeHeadlessOutcome({
        stdout: ran.stdout,
        stderr: ran.stderr,
        exitCode: ran.code,
        format,
      });
      const sessionId =
        parsed.sessionId ??
        (isPendingSessionId(session.sessionId) ? session.sessionId : session.sessionId);

      if (parsed.isError) {
        const login = /not signed in|not logged in|keychain is locked/i.test(
          `${parsed.errorMessage}\n${ran.stderr}`,
        );
        const result = this.fail(task.taskId, session, started, {
          code: "agent_failed",
          message: parsed.errorMessage ?? "Cursor failed.",
          hint: login
            ? "Unlock the login keychain or run `AGENT_CLI_CREDENTIAL_STORE=file cursor-agent login`. Do not use `agent` — that name is Grok on some PATHs."
            : undefined,
        });
        result.output = parsed.output;
        result.summary = summariseOutput(parsed.output || result.summary);
        result.sessionId = sessionId;
        result.filesChanged = parsed.filesChanged;
        this.store.complete(task.taskId, result);
        return result;
      }

      const result: DelegationResult = {
        taskId: task.taskId,
        sessionId,
        agentId: this.agentId,
        status: "succeeded",
        cwd: cwdCheck.cwd,
        output: parsed.output,
        summary: summariseOutput(parsed.output || "Cursor completed with no assistant message."),
        filesChanged: parsed.filesChanged,
        durationMs: Date.now() - started,
      };
      this.store.complete(task.taskId, result);
      return result;
    } finally {
      this.inflight.delete(task.taskId);
    }
  }

  async cancel(taskId: string): Promise<void> {
    this.inflight.get(taskId)?.abort();
    try {
      this.store.cancel(taskId);
    } catch {
      // unknown task ids are a no-op
    }
  }

  async close(_session: Session): Promise<void> {
    // Process-scoped handle.
  }

  private fail(
    taskId: string,
    session: Session,
    started: number,
    error: DelegationError,
  ): DelegationResult {
    return {
      taskId,
      sessionId: session.sessionId,
      agentId: this.agentId,
      status: "failed",
      cwd: session.cwd,
      summary: error.message,
      output: "",
      filesChanged: [],
      durationMs: Date.now() - started,
      error,
    };
  }
}
