import { Role, TaskState, type Message } from "@a2a-js/sdk";
import {
  AgentEvent,
  type AgentExecutionEvent,
  type AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
} from "@a2a-js/sdk/server";
import { newTaskId, type AgentId, type Availability, type SandboxMode } from "@occ/core";
import type { OccAgentExecutor } from "@occ/a2a";
import type { AuditLog } from "./audit.js";
import { sandboxAllowed, type AgentPolicy } from "./config.js";

const SANDBOXES: readonly SandboxMode[] = ["read-only", "workspace-write", "danger-full-access"];

function agentMessage(taskId: string, contextId: string, text: string): Message {
  return {
    messageId: newTaskId(),
    contextId,
    taskId,
    role: Role.ROLE_AGENT,
    parts: [{ content: { $case: "text", value: text }, metadata: undefined, filename: "", mediaType: "text/plain" }],
    metadata: undefined,
    extensions: [],
    referenceTaskIds: [],
  };
}

/** Forwards events while remembering the terminal state for the audit entry. */
class TerminalCapturingBus {
  terminal: string | undefined;

  constructor(private readonly inner: ExecutionEventBus) {}

  publish(event: AgentExecutionEvent): void {
    if (event.kind === "statusUpdate") {
      const state = event.data.status?.state;
      if (
        state === TaskState.TASK_STATE_COMPLETED ||
        state === TaskState.TASK_STATE_FAILED ||
        state === TaskState.TASK_STATE_CANCELED
      ) {
        this.terminal =
          state === TaskState.TASK_STATE_COMPLETED
            ? "succeeded"
            : state === TaskState.TASK_STATE_CANCELED
              ? "cancelled"
              : "failed";
      }
    }
    this.inner.publish(event);
  }

  finished(): void {
    this.inner.finished();
  }

  on(...args: unknown[]): this {
    (this.inner.on as (...a: unknown[]) => void)(...args);
    return this;
  }
  off(...args: unknown[]): this {
    (this.inner.off as (...a: unknown[]) => void)(...args);
    return this;
  }
  once(...args: unknown[]): this {
    (this.inner.once as (...a: unknown[]) => void)(...args);
    return this;
  }
}

export interface EnforcingExecutorOptions {
  agentId: AgentId;
  inner: OccAgentExecutor;
  policy: AgentPolicy;
  audit: AuditLog;
  availability: () => Promise<Availability>;
}

/**
 * Control-plane mediation in front of an agent executor: policy checks
 * (enabled, sandbox cap, availability) before any spawn, and an audit entry
 * for every task — allowed or rejected.
 */
export class EnforcingExecutor implements AgentExecutor {
  private readonly opts: EnforcingExecutorOptions;

  constructor(options: EnforcingExecutorOptions) {
    this.opts = options;
  }

  async execute(context: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const started = Date.now();
    const { taskId, contextId } = context;
    const meta = (context.userMessage.metadata ?? {}) as Record<string, unknown>;
    const sandbox = SANDBOXES.includes(meta.sandbox as SandboxMode)
      ? (meta.sandbox as SandboxMode)
      : "workspace-write";
    const model = typeof meta.model === "string" ? meta.model : undefined;

    const rejection = await this.checkPolicy(sandbox);
    if (rejection) {
      this.publishFailed(context, eventBus, rejection);
      this.opts.audit.append({
        ts: new Date().toISOString(),
        agentId: this.opts.agentId,
        a2aTaskId: taskId,
        contextId,
        sandbox,
        model,
        status: "rejected",
        durationMs: Date.now() - started,
        error: rejection,
      });
      return;
    }

    const bus = new TerminalCapturingBus(eventBus);
    try {
      await this.opts.inner.execute(context, bus as unknown as ExecutionEventBus);
    } catch (error) {
      bus.terminal = "failed";
      this.publishFailed(context, eventBus, error instanceof Error ? error.message : String(error));
    }
    this.opts.audit.append({
      ts: new Date().toISOString(),
      agentId: this.opts.agentId,
      a2aTaskId: taskId,
      contextId,
      sandbox,
      model,
      status: bus.terminal ?? "unknown",
      durationMs: Date.now() - started,
    });
  }

  async cancelTask(taskId: string, eventBus: ExecutionEventBus): Promise<void> {
    await this.opts.inner.cancelTask(taskId, eventBus);
  }

  private async checkPolicy(sandbox: SandboxMode): Promise<string | undefined> {
    const { policy, agentId } = this.opts;
    if (!policy.enabled) {
      return `Agent "${agentId}" is disabled by control-plane policy (~/.occ/orbital.json).`;
    }
    if (!sandboxAllowed(sandbox, policy.maxSandbox)) {
      return `Sandbox "${sandbox}" exceeds the policy cap "${policy.maxSandbox}" for ${agentId}. Raise maxSandbox in ~/.occ/orbital.json to allow it.`;
    }
    const availability = await this.opts.availability();
    if (!availability.available) {
      return `Agent "${agentId}" is not available: ${availability.detail}`;
    }
    if (!availability.authenticated) {
      return `Agent "${agentId}" is not authenticated: ${availability.detail}`;
    }
    return undefined;
  }

  private publishFailed(context: RequestContext, eventBus: ExecutionEventBus, reason: string): void {
    const { taskId, contextId } = context;
    eventBus.publish(
      AgentEvent.task({
        id: taskId,
        contextId,
        status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: new Date().toISOString() },
        artifacts: [],
        history: [context.userMessage],
        metadata: undefined,
      }),
    );
    eventBus.publish(
      AgentEvent.statusUpdate({
        taskId,
        contextId,
        status: {
          state: TaskState.TASK_STATE_FAILED,
          message: agentMessage(taskId, contextId, reason),
          timestamp: new Date().toISOString(),
        },
        metadata: undefined,
      }),
    );
    eventBus.finished();
  }
}
