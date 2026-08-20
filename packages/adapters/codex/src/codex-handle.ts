import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  clampTimeout,
  lineSplitter,
  resolveCwd,
  summariseOutput,
  validateCwd,
} from "@occ/adapter-kit";
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
import { probeCodexAvailability } from "./availability.js";
import { parseExecJsonl, streamEventFromExecLine } from "./parse-exec-jsonl.js";
import { runCodexExec } from "./run-exec.js";
import {
  DEFAULT_SANDBOX,
  buildCodexExecArgs,
  buildCodexReviewArgs,
  resolveCodexBin,
  type CodexReviewTarget,
} from "./spawn-args.js";

export interface CodexReviewOptions {
  target: CodexReviewTarget;
  /** Custom review instructions. */
  prompt?: string;
  model?: string;
  effort?: PromptRequest["effort"];
  timeoutMs?: number;
}

const execFileAsync = promisify(execFile);

export class CodexAgentHandle implements AgentHandle {
  readonly agentId: AgentId = "codex";
  readonly displayName = "Codex";

  private readonly store: InMemoryTaskStore;
  private readonly inflight = new Map<string, AbortController>();
  private readonly sessionModels = new Map<string, string>();

  constructor(store?: InMemoryTaskStore) {
    this.store = store ?? new InMemoryTaskStore();
  }

  capabilities(): AgentCapabilities {
    return {
      streaming: true,
      resume: true,
      cancel: true,
      sandboxModes: ["read-only", "workspace-write", "danger-full-access"],
    };
  }

  isAvailable(): Promise<Availability> {
    return probeCodexAvailability();
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
    return this.runJob(session, request, (lastMessagePath, cwd) =>
      buildCodexExecArgs({
        cwd,
        brief: request.brief,
        sandbox: request.sandbox ?? DEFAULT_SANDBOX,
        model: this.sessionModels.get(session.sessionId),
        effort: request.effort,
        resumeSessionId: session.sessionId,
        images: request.images,
        lastMessagePath,
      }),
    );
  }

  /**
   * First-class `codex exec review`. Always read-only. Session model carries
   * over; review never resumes a thread.
   */
  async review(session: Session, opts: CodexReviewOptions): Promise<DelegationResult> {
    const request: PromptRequest = {
      brief: opts.prompt ?? "Review the changes.",
      sandbox: "read-only",
      effort: opts.effort,
      timeoutMs: opts.timeoutMs,
    };
    return this.runJob(session, request, (lastMessagePath) =>
      buildCodexReviewArgs({
        target: opts.target,
        prompt: opts.prompt,
        model: opts.model ?? this.sessionModels.get(session.sessionId),
        effort: opts.effort,
        lastMessagePath,
      }),
    );
  }

  private async runJob(
    session: Session,
    request: PromptRequest,
    buildArgs: (lastMessagePath: string, cwd: string) => string[],
  ): Promise<DelegationResult> {
    const started = Date.now();
    const task = this.store.create({
      sessionId: session.sessionId,
      agentId: this.agentId,
      request,
    });
    this.store.markRunning(task.taskId);

    const cwdCheck = await validateCwd(session.cwd);
    if (!cwdCheck.ok) {
      const result = this.fail(task.taskId, session, request, started, {
        code: "invalid_cwd",
        message: cwdCheck.message,
        hint: "Pass an existing directory as cwd.",
      });
      this.store.complete(task.taskId, result);
      return result;
    }

    const timeoutMs = clampTimeout(request.timeoutMs);
    const tmp = await mkdtemp(join(tmpdir(), "occ-codex-"));
    const lastMessagePath = join(tmp, "last-message.txt");
    const controller = new AbortController();
    this.inflight.set(task.taskId, controller);

    const args = buildArgs(lastMessagePath, cwdCheck.cwd);

    let splitter: ReturnType<typeof lineSplitter> | undefined;
    if (request.onEvent) {
      const emit = request.onEvent;
      splitter = lineSplitter((line) => {
        const event = streamEventFromExecLine(line);
        if (event) emit(event);
      });
    }

    try {
      const ran = await runCodexExec({
        bin: resolveCodexBin(),
        args,
        cwd: cwdCheck.cwd,
        timeoutMs,
        lastMessagePath,
        signal: controller.signal,
        onStdoutData: splitter?.push,
      });
      // Deliver a final event whose line never got a trailing newline.
      splitter?.flush();

      if (ran.spawnError) {
        const result = this.fail(task.taskId, session, request, started, {
          code: "spawn_failed",
          message: ran.spawnError,
          hint: "Install Codex and ensure it is on PATH, or set CODEX_BIN.",
        });
        this.store.complete(task.taskId, result);
        return result;
      }

      if (ran.cancelled) {
        const result = this.fail(task.taskId, session, request, started, {
          code: "cancelled",
          message: "Delegation cancelled.",
        });
        result.status = "cancelled";
        this.store.complete(task.taskId, result);
        return result;
      }

      if (ran.timedOut) {
        const result = this.fail(task.taskId, session, request, started, {
          code: "timeout",
          message: `Codex exceeded timeout of ${timeoutMs}ms.`,
          hint: "Tighten the brief or raise timeout_ms (max 1800000).",
        });
        this.store.complete(task.taskId, result);
        return result;
      }

      const parsed = parseExecJsonl(ran.stdout);
      const output = parsed.output || ran.lastMessage;
      const sessionId =
        parsed.threadId ??
        (isPendingSessionId(session.sessionId) ? session.sessionId : session.sessionId);

      if (parsed.fatalError || parsed.turnFailed || ran.code !== 0) {
        const message =
          parsed.turnFailed ??
          parsed.fatalError ??
          ran.stderr.trim() ??
          `codex exec exited ${ran.code}`;
        const login = /not logged in|codex login/i.test(`${message}\n${ran.stderr}`);
        const result = this.fail(task.taskId, session, request, started, {
          code: "agent_failed",
          message,
          hint: login ? "Run `codex login` and retry." : undefined,
        });
        result.output = output;
        result.summary = summariseOutput(output || message);
        result.sessionId = sessionId;
        result.filesChanged = parsed.filesChanged;
        result.usage = parsed.usage;
        this.store.complete(task.taskId, result);
        return result;
      }

      let filesChanged = parsed.filesChanged;
      let diffStat: string | undefined;
      if (filesChanged.length === 0) {
        const statResult = await tryGitDiffStat(cwdCheck.cwd);
        if (statResult) diffStat = statResult;
      }

      const result: DelegationResult = {
        taskId: task.taskId,
        sessionId,
        agentId: this.agentId,
        status: "succeeded",
        cwd: cwdCheck.cwd,
        output,
        summary: summariseOutput(output || "Codex completed with no assistant message."),
        filesChanged,
        diffStat,
        durationMs: Date.now() - started,
        usage: parsed.usage,
      };
      this.store.complete(task.taskId, result);
      return result;
    } finally {
      this.inflight.delete(task.taskId);
      await rm(tmp, { recursive: true, force: true });
    }
  }

  async cancel(taskId: string): Promise<void> {
    this.inflight.get(taskId)?.abort();
    try {
      this.store.cancel(taskId);
    } catch {
      // unknown task ids are a no-op for cancel
    }
  }

  async close(_session: Session): Promise<void> {
    // Process-scoped handle; nothing to persist.
  }

  private fail(
    taskId: string,
    session: Session,
    _request: PromptRequest,
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

async function tryGitDiffStat(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", cwd, "diff", "--stat"], {
      timeout: 5_000,
    });
    const text = stdout.trim();
    return text === "" ? undefined : text;
  } catch {
    return undefined;
  }
}

