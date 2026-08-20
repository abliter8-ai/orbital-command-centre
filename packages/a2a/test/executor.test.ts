import { Role, TaskState, type Message } from "@a2a-js/sdk";
import type { ExecutionEventBus, RequestContext } from "@a2a-js/sdk/server";
import {
  FakeAgentHandle,
  InMemoryTaskStore,
  type AgentCapabilities,
  type AgentHandle,
  type AgentId,
  type Availability,
  type DelegationResult,
  type PromptRequest,
  type Session,
  type SessionOptions,
} from "@occ/core";
import { describe, expect, it } from "vitest";
import { buildAgentCard } from "../src/card.js";
import { OccAgentExecutor, messageText } from "../src/executor.js";

function userMessage(text: string, metadata: Record<string, unknown> = {}): Message {
  return {
    messageId: "m1",
    contextId: "ctx-1",
    taskId: "",
    role: Role.ROLE_USER,
    parts: [{ content: { $case: "text", value: text }, metadata: undefined, filename: "", mediaType: "text/plain" }],
    metadata,
    extensions: [],
    referenceTaskIds: [],
  };
}

function fakeContext(message: Message, taskId = "a2a-task-1"): RequestContext {
  return {
    request: { message },
    taskId,
    contextId: message.contextId,
    context: {},
    userMessage: message,
  } as unknown as RequestContext;
}

class CapturingBus {
  events: { kind: string; data: unknown }[] = [];
  finishedCalls = 0;
  publish(event: { kind: string; data: unknown }): void {
    this.events.push(event);
  }
  finished(): void {
    this.finishedCalls += 1;
  }
  on(): this { return this; }
  off(): this { return this; }
  once(): this { return this; }
}

describe("messageText", () => {
  it("extracts text parts and notes url references", () => {
    const message = userMessage("hello");
    message.parts.push({
      content: { $case: "url", value: "https://example.com/spec.pdf" },
      metadata: undefined,
      filename: "",
      mediaType: "application/pdf",
    });
    expect(messageText(message)).toBe("hello\n[reference: https://example.com/spec.pdf]");
  });
});

describe("OccAgentExecutor", () => {
  it("publishes task → artifact → completed for a succeeded delegation", async () => {
    const handle = new FakeAgentHandle({ output: "the answer", summary: "done" });
    const store = new InMemoryTaskStore();
    const executor = new OccAgentExecutor({ handle, store });
    const bus = new CapturingBus();

    await executor.execute(fakeContext(userMessage("do it", { sandbox: "read-only" })), bus as unknown as ExecutionEventBus);

    expect(bus.events[0]?.kind).toBe("task");
    expect(bus.events.map((event) => event.kind)).toEqual(["task", "artifactUpdate", "statusUpdate"]);
    const status = bus.events.at(-1)?.data as { status: { state: TaskState } };
    expect(status.status.state).toBe(TaskState.TASK_STATE_COMPLETED);
    expect(bus.finishedCalls).toBe(1);
    expect(handle.prompts[0]?.request.sandbox).toBe("read-only");
  });

  it("publishes failed with the error message when the delegation fails", async () => {
    const handle = new FakeAgentHandle({
      status: "failed",
      error: { code: "timeout", message: "too slow", hint: "raise timeout_ms" },
    });
    const executor = new OccAgentExecutor({ handle, store: new InMemoryTaskStore() });
    const bus = new CapturingBus();

    await executor.execute(fakeContext(userMessage("do it")), bus as unknown as ExecutionEventBus);

    const status = bus.events.at(-1)?.data as {
      status: { state: TaskState; message?: Message };
    };
    expect(status.status.state).toBe(TaskState.TASK_STATE_FAILED);
    const part = status.status.message?.parts[0]?.content;
    expect(part?.$case === "text" && part.value).toMatch(/too slow.*raise timeout_ms/);
    expect(bus.finishedCalls).toBe(1);
  });

  it("routes cancelTask to the in-flight OCC task", async () => {
    const store = new InMemoryTaskStore();
    const handle = new BlockingHandle(store);
    const executor = new OccAgentExecutor({ handle, store });
    const bus = new CapturingBus();

    const pending = executor.execute(fakeContext(userMessage("long")), bus as unknown as ExecutionEventBus);
    await new Promise((resolve) => setImmediate(resolve));
    await executor.cancelTask("a2a-task-1", bus as unknown as ExecutionEventBus);
    await pending;

    expect(handle.cancelledTaskId).toBeTruthy();
    const status = bus.events.at(-1)?.data as { status: { state: TaskState } };
    expect(status.status.state).toBe(TaskState.TASK_STATE_CANCELED);
    expect(bus.finishedCalls).toBe(1);
  });
});

class BlockingHandle implements AgentHandle {
  readonly agentId: AgentId = "codex";
  readonly displayName = "Blocking";
  cancelledTaskId: string | undefined;
  private release: (() => void) | undefined;

  constructor(private readonly store: InMemoryTaskStore) {}

  capabilities(): AgentCapabilities {
    return { streaming: false, resume: false, cancel: true, sandboxModes: ["workspace-write"] };
  }
  async isAvailable(): Promise<Availability> {
    return { available: true, authenticated: true, detail: "fake" };
  }
  async startSession(opts: SessionOptions): Promise<Session> {
    return { sessionId: "blocking-session", agentId: this.agentId, cwd: opts.cwd ?? "/tmp", createdAt: new Date().toISOString() };
  }
  prompt(session: Session, request: PromptRequest): Promise<DelegationResult> {
    const task = this.store.create({ sessionId: session.sessionId, agentId: this.agentId, request });
    this.store.markRunning(task.taskId);
    return new Promise<DelegationResult>((resolve) => {
      this.release = () => {
        const result: DelegationResult = {
          taskId: task.taskId,
          sessionId: session.sessionId,
          agentId: this.agentId,
          status: "cancelled",
          cwd: session.cwd,
          summary: "cancelled",
          output: "",
          filesChanged: [],
          durationMs: 1,
        };
        this.store.complete(task.taskId, result);
        resolve(result);
      };
    });
  }
  async cancel(taskId: string): Promise<void> {
    this.cancelledTaskId = taskId;
    this.release?.();
  }
  async close(): Promise<void> {}
}

describe("buildAgentCard", () => {
  it("builds a card with delegate + native skills from the capability profile", () => {
    const card = buildAgentCard("grok", "http://127.0.0.1:7003");
    expect(card.name).toBe("OCC Grok");
    expect(card.supportedInterfaces[0]?.url).toBe("http://127.0.0.1:7003");
    expect(card.capabilities?.streaming).toBe(true);
    const skillIds = card.skills.map((skill) => skill.id);
    expect(skillIds).toContain("delegate");
    expect(skillIds).toContain("x-keyword-search");
    expect(skillIds).toContain("image-to-video-reference-to-video");
  });
});
