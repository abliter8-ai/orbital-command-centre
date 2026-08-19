import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { clampTimeout, resolveCwd, runChild, summariseOutput, validateCwd } from "@occ/adapter-kit";
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
import { probeAgyAvailability } from "./availability.js";
import { parseAgyJson } from "./parse-json.js";
import { DEFAULT_SANDBOX, buildHeadlessArgs, resolveAgyBin } from "./spawn-args.js";

const execFileAsync = promisify(execFile);

export class AntigravityAgentHandle implements AgentHandle {
  readonly agentId: AgentId = "antigravity";
  readonly displayName = "Antigravity";

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
    return probeAgyAvailability();
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
    const timeoutMs = clampTimeout(request.timeoutMs);
    const controller = new AbortController();
    this.inflight.set(task.taskId, controller);
    const args = buildHeadlessArgs({
      cwd: cwdCheck.cwd,
      brief: request.brief,
      sandbox,
      model: this.sessionModels.get(session.sessionId),
      effort: request.effort,
      resumeSessionId: session.sessionId,
      timeoutMs,
    });

    try {
      const ran = await runChild({
        bin: resolveAgyBin(),
        args,
        cwd: cwdCheck.cwd,
        timeoutMs,
        signal: controller.signal,
      });

      if (ran.spawnError) {
        const result = this.fail(task.taskId, session, started, {
          code: "spawn_failed",
          message: ran.spawnError,
          hint: "Install the Antigravity CLI (`agy` on PATH) or set AGY_BIN. Do not use `gemini`.",
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
          message: `Antigravity exceeded timeout of ${timeoutMs}ms.`,
          hint: "Tighten the brief or raise timeout_ms (max 1800000).",
        });
        this.store.complete(task.taskId, result);
        return result;
      }

      const parsed = parseAgyJson(ran.stdout, ran.stderr, ran.code);
      const sessionId = parsed.sessionId ?? session.sessionId;

      if (parsed.isError) {
        const login = /authentication required|not logged in/i.test(
          `${parsed.errorMessage}\n${ran.stderr}`,
        );
        const result = this.fail(task.taskId, session, started, {
          code: "agent_failed",
          message: parsed.errorMessage ?? "Antigravity failed.",
          hint: login
            ? "Run interactive `agy` once (cached OAuth) or set modelProvider=gemini + GEMINI_API_KEY."
            : parsed.softDenied
              ? "Tool was soft-denied. Add permissions.allow in ~/.gemini/antigravity-cli/settings.json or use sandbox danger-full-access."
              : undefined,
        });
        result.output = parsed.output;
        result.summary = summariseOutput(parsed.output || result.summary);
        result.sessionId = sessionId;
        result.usage = parsed.usage;
        this.store.complete(task.taskId, result);
        return result;
      }

      const diffStat = await tryGitDiffStat(cwdCheck.cwd);
      const filesChanged: DelegationResult["filesChanged"] = [];
      const summary = parsed.softDenied
        ? `${summariseOutput(parsed.output || "Antigravity completed.")} (check stderr: a tool may have been soft-denied)`
        : summariseOutput(parsed.output || "Antigravity completed with no assistant text.");

      const result: DelegationResult = {
        taskId: task.taskId,
        sessionId,
        agentId: this.agentId,
        status: "succeeded",
        cwd: cwdCheck.cwd,
        output: parsed.output,
        summary,
        filesChanged,
        diffStat,
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
      // unknown ids are a no-op
    }
  }

  async close(_session: Session): Promise<void> {}

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
