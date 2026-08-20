import {
  clampTimeout,
  lineSplitter,
  resolveCwd,
  runChild,
  summariseOutput,
  validateCwd,
} from "@occ/adapter-kit";
import {
  InMemoryTaskStore,
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
import { probeClaudeAvailability } from "./availability.js";
import { parseClaudeStreamJsonl, streamEventFromClaudeLine } from "./parse-headless.js";
import {
  DEFAULT_SANDBOX,
  buildClaudeHeadlessArgs,
  resolveClaudeBin,
} from "./spawn-args.js";

export class ClaudeAgentHandle implements AgentHandle {
  readonly agentId: AgentId = "claude";
  readonly displayName = "Claude";

  private readonly store: InMemoryTaskStore;
  private readonly inflight = new Map<string, AbortController>();
  private readonly sessionModels = new Map<string, string>();

  constructor(store?: InMemoryTaskStore) {
    this.store = store ?? new InMemoryTaskStore();
  }

  capabilities(): AgentCapabilities {
    return {
      // stream-json in every sandbox mode.
      streaming: true,
      resume: true,
      cancel: true,
      sandboxModes: ["read-only", "workspace-write", "danger-full-access"],
    };
  }

  isAvailable(): Promise<Availability> {
    return probeClaudeAvailability();
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
    const controller = new AbortController();
    this.inflight.set(task.taskId, controller);

    const args = buildClaudeHeadlessArgs({
      sandbox,
      model: this.sessionModels.get(session.sessionId),
      resumeSessionId: session.sessionId,
    });

    let splitter: ReturnType<typeof lineSplitter> | undefined;
    if (request.onEvent) {
      const emit = request.onEvent;
      splitter = lineSplitter((line) => {
        const event = streamEventFromClaudeLine(line);
        if (event) emit(event);
      });
    }

    try {
      const ran = await runChild({
        bin: resolveClaudeBin(),
        args,
        cwd: cwdCheck.cwd,
        timeoutMs: clampTimeout(request.timeoutMs),
        stdin: request.brief.endsWith("\n") ? request.brief : `${request.brief}\n`,
        signal: controller.signal,
        onStdoutData: splitter?.push,
      });
      // Deliver a final event whose line never got a trailing newline.
      splitter?.flush();

      if (ran.spawnError) {
        const result = this.fail(task.taskId, session, started, {
          code: "spawn_failed",
          message: ran.spawnError,
          hint: "Install Claude Code (`claude` on PATH) or set CLAUDE_BIN.",
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
          message: `Claude exceeded timeout of ${clampTimeout(request.timeoutMs)}ms.`,
          hint: "Tighten the brief or raise timeout_ms (max 1800000).",
        });
        this.store.complete(task.taskId, result);
        return result;
      }

      const parsed = parseClaudeStreamJsonl(ran.stdout);
      const sessionId = parsed.sessionId ?? session.sessionId;

      if (parsed.isError || ran.code !== 0) {
        const login = /not logged in|not authenticated|invalid api key|unauthorized/i.test(
          `${parsed.errorMessage ?? ""}\n${parsed.output}\n${ran.stderr}`,
        );
        const result = this.fail(task.taskId, session, started, {
          code: "agent_failed",
          message:
            parsed.errorMessage ??
            parsed.output ??
            `Claude exited ${ran.code}. ${ran.stderr.trim()}`.trim(),
          hint: login ? "Run `claude auth login`." : undefined,
        });
        result.output = parsed.output;
        result.summary = summariseOutput(parsed.output || result.summary);
        result.sessionId = sessionId;
        result.filesChanged = parsed.filesChanged;
        this.store.complete(task.taskId, result);
        return result;
      }

      const cost = parsed.costUsd !== undefined ? ` ($${parsed.costUsd.toFixed(4)})` : "";
      const result: DelegationResult = {
        taskId: task.taskId,
        sessionId,
        agentId: this.agentId,
        status: "succeeded",
        cwd: cwdCheck.cwd,
        output: parsed.output,
        summary: summariseOutput(
          (parsed.output || "Claude completed with no assistant message.") + cost,
        ),
        filesChanged: parsed.filesChanged,
        durationMs: Date.now() - started,
        usage: parsed.usage,
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
