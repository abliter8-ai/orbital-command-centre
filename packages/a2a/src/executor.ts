import { Role, TaskState, type Message } from "@a2a-js/sdk";
import {
  AgentEvent,
  type AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
} from "@a2a-js/sdk/server";
import {
  InMemoryTaskStore as OccTaskStore,
  newTaskId,
  type AgentHandle,
  type DelegationResult,
  type ReasoningEffort,
  type SandboxMode,
  type Session,
  type StreamEvent,
} from "@occ/core";

const SANDBOXES: readonly SandboxMode[] = ["read-only", "workspace-write", "danger-full-access"];
const EFFORTS: readonly ReasoningEffort[] = ["low", "medium", "high", "xhigh", "max"];

export interface OccExecutorOptions {
  handle: AgentHandle;
  /** The store the handle writes into — used to route cancelTask. */
  store: OccTaskStore;
  defaultSandbox?: SandboxMode;
  defaultCwd?: string;
}

/** Text of an A2A message: text parts joined; url parts noted as references. */
export function messageText(message: Message): string {
  const parts: string[] = [];
  for (const part of message.parts) {
    const content = part.content;
    if (content?.$case === "text") parts.push(content.value);
    else if (content?.$case === "url") parts.push(`[reference: ${content.value}]`);
  }
  return parts.join("\n");
}

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

/**
 * Bridges A2A task lifecycle onto one OCC AgentHandle. Single publisher: this
 * executor owns every event for its tasks; cancelTask only signals the handle
 * and the in-flight execute() publishes the terminal CANCELED event.
 */
export class OccAgentExecutor implements AgentExecutor {
  private readonly handle: AgentHandle;
  private readonly store: OccTaskStore;
  private readonly defaultSandbox: SandboxMode;
  private readonly defaultCwd: string;
  private readonly sessionsByContext = new Map<string, Session>();
  private readonly occTaskByA2aTask = new Map<string, string>();

  constructor(options: OccExecutorOptions) {
    this.handle = options.handle;
    this.store = options.store;
    this.defaultSandbox = options.defaultSandbox ?? "workspace-write";
    this.defaultCwd = options.defaultCwd ?? process.cwd();
  }

  async execute(context: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const { taskId, contextId } = context;
    const brief = messageText(context.userMessage);
    const meta = (context.userMessage.metadata ?? {}) as Record<string, unknown>;
    const sandbox = SANDBOXES.includes(meta.sandbox as SandboxMode)
      ? (meta.sandbox as SandboxMode)
      : this.defaultSandbox;
    const effort = EFFORTS.includes(meta.effort as ReasoningEffort)
      ? (meta.effort as ReasoningEffort)
      : undefined;
    const model = typeof meta.model === "string" && meta.model.trim() !== "" ? meta.model.trim() : undefined;
    const cwd = typeof meta.cwd === "string" && meta.cwd.trim() !== "" ? meta.cwd.trim() : this.defaultCwd;

    // First event must be the task itself.
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

    // Progressive publishing: streaming handles (codex, cursor) emit text as
    // appended artifact chunks and tool activity as working-status updates.
    // Buffered handles never call onEvent and get the single-shot artifact.
    const streamArtifactId = `result-${taskId}`;
    let streamedText = false;
    const onEvent = (event: StreamEvent): void => {
      if (event.kind === "text") {
        streamedText = true;
        eventBus.publish(
          AgentEvent.artifactUpdate({
            taskId,
            contextId,
            artifact: {
              artifactId: streamArtifactId,
              name: "result",
              description: "",
              parts: [
                {
                  content: { $case: "text", value: event.text },
                  metadata: undefined,
                  filename: "",
                  mediaType: "text/plain",
                },
              ],
              metadata: undefined,
              extensions: [],
            },
            append: true,
            lastChunk: false,
            metadata: undefined,
          }),
        );
        return;
      }
      eventBus.publish(
        AgentEvent.statusUpdate({
          taskId,
          contextId,
          status: {
            state: TaskState.TASK_STATE_WORKING,
            message: agentMessage(
              taskId,
              contextId,
              `${event.kind === "tool_start" ? "tool started" : "tool finished"}: ${event.text}`,
            ),
            timestamp: new Date().toISOString(),
          },
          metadata: undefined,
        }),
      );
    };

    let result: DelegationResult;
    try {
      const session = await this.sessionFor(contextId, cwd, model);
      const running = this.handle.prompt(session, { brief, sandbox, effort, onEvent });
      // Handles register the task synchronously before their first await.
      const occTask = this.store
        .list({ status: ["queued", "running"] })
        .find((task) => task.sessionId === session.sessionId);
      if (occTask) this.occTaskByA2aTask.set(taskId, occTask.taskId);
      result = await running;
    } catch (error) {
      result = {
        taskId: "task_error",
        sessionId: "none",
        agentId: this.handle.agentId,
        status: "failed",
        cwd,
        summary: error instanceof Error ? error.message : String(error),
        output: "",
        filesChanged: [],
        durationMs: 0,
        error: { code: "agent_failed", message: error instanceof Error ? error.message : String(error) },
      };
    } finally {
      this.occTaskByA2aTask.delete(taskId);
    }

    if (result.status === "succeeded" && !streamedText) {
      eventBus.publish(
        AgentEvent.artifactUpdate({
          taskId,
          contextId,
          artifact: {
            artifactId: newTaskId(),
            name: "result",
            description: result.summary,
            parts: [
              {
                content: { $case: "text", value: result.output || result.summary },
                metadata: undefined,
                filename: "",
                mediaType: "text/plain",
              },
            ],
            metadata: {
              filesChanged: result.filesChanged,
              durationMs: result.durationMs,
              occSessionId: result.sessionId,
            },
            extensions: [],
          },
          append: false,
          lastChunk: true,
          metadata: undefined,
        }),
      );
    }

    if (result.status === "succeeded" && streamedText) {
      // Close the streamed artifact: lastChunk marker with the run metadata.
      eventBus.publish(
        AgentEvent.artifactUpdate({
          taskId,
          contextId,
          artifact: {
            artifactId: streamArtifactId,
            name: "result",
            description: result.summary,
            parts: [],
            metadata: {
              filesChanged: result.filesChanged,
              durationMs: result.durationMs,
              occSessionId: result.sessionId,
            },
            extensions: [],
          },
          append: true,
          lastChunk: true,
          metadata: undefined,
        }),
      );
    }

    const terminal =
      result.status === "succeeded"
        ? TaskState.TASK_STATE_COMPLETED
        : result.status === "cancelled"
          ? TaskState.TASK_STATE_CANCELED
          : TaskState.TASK_STATE_FAILED;
    eventBus.publish(
      AgentEvent.statusUpdate({
        taskId,
        contextId,
        status: {
          state: terminal,
          message:
            result.status === "succeeded"
              ? undefined
              : agentMessage(
                  taskId,
                  contextId,
                  result.error
                    ? `${result.error.message}${result.error.hint ? ` Hint: ${result.error.hint}` : ""}`
                    : result.summary,
                ),
          timestamp: new Date().toISOString(),
        },
        metadata: undefined,
      }),
    );
    eventBus.finished();
  }

  async cancelTask(taskId: string, _eventBus: ExecutionEventBus): Promise<void> {
    const occTaskId = this.occTaskByA2aTask.get(taskId);
    if (occTaskId) {
      await this.handle.cancel(occTaskId);
    }
  }

  private async sessionFor(contextId: string, cwd: string, model?: string): Promise<Session> {
    const existing = this.sessionsByContext.get(contextId);
    if (existing) return existing;
    const session = await this.handle.startSession({ cwd, model });
    this.sessionsByContext.set(contextId, session);
    return session;
  }
}
