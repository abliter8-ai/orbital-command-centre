import * as acp from "@agentclientprotocol/sdk";
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
import { OccAcpAgent, promptText } from "../src/server.js";

function linkedStreams() {
  const a2b = new TransformStream<Uint8Array, Uint8Array>();
  const b2a = new TransformStream<Uint8Array, Uint8Array>();
  return {
    agentStream: acp.ndJsonStream(a2b.writable, b2a.readable),
    clientStream: acp.ndJsonStream(b2a.writable, a2b.readable),
  };
}

function serve(occ: OccAcpAgent) {
  const { agentStream, clientStream } = linkedStreams();
  acp
    .agent({ name: "test-agent" })
    .onRequest("initialize", (ctx) => occ.initialize(ctx.params))
    .onRequest("authenticate", (ctx) => occ.authenticate(ctx.params))
    .onRequest("session/new", (ctx) => occ.newSession(ctx.params))
    .onRequest("session/set_mode", (ctx) => occ.setSessionMode(ctx.params))
    .onRequest("session/prompt", (ctx) => occ.prompt(ctx.params, ctx.client))
    .onNotification("session/cancel", (ctx) => occ.cancel(ctx.params))
    .connect(agentStream);
  return clientStream;
}

describe("OccAcpAgent over the wire", () => {
  it("initialize → newSession → prompt round-trips a delegation", async () => {
    const handle = new FakeAgentHandle({ output: "wire result text" });
    const store = new InMemoryTaskStore();
    const updates: { sessionUpdate: string; text?: string }[] = [];

    const client = acp.client({ name: "test-client" });
    const result = await client.connectWith(serve(new OccAcpAgent({ handle, store })), async (ctx) => {
      const init = await ctx.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
      });
      expect(init.agentInfo?.name).toBe("occ-codex");

      const session = await ctx.request(acp.methods.agent.session.new, {
        cwd: "/tmp",
        mcpServers: [],
      });
      expect(session.sessionId).toBeTruthy();
      expect(session.modes?.availableModes.map((mode) => mode.id)).toContain("workspace-write");

      return ctx.request(acp.methods.agent.session.prompt, {
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: "Reply with PING" }],
      });
    });

    expect(result.stopReason).toBe("end_turn");
    expect(handle.prompts).toHaveLength(1);
    expect(handle.prompts[0]?.request.brief).toBe("Reply with PING");
    expect(handle.prompts[0]?.request.sandbox).toBe("workspace-write");
  });

  it("maps a failed delegation to stopReason refusal", async () => {
    const handle = new FakeAgentHandle({
      status: "failed",
      error: { code: "not_authenticated", message: "not logged in", hint: "run login" },
    });
    const store = new InMemoryTaskStore();
    const client = acp.client({ name: "test-client" });
    const result = await client.connectWith(serve(new OccAcpAgent({ handle, store })), async (ctx) => {
      await ctx.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
      });
      const session = await ctx.request(acp.methods.agent.session.new, {
        cwd: "/tmp",
        mcpServers: [],
      });
      return ctx.request(acp.methods.agent.session.prompt, {
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: "do work" }],
      });
    });
    expect(result.stopReason).toBe("refusal");
  });

  it("rejects an unknown session mode", async () => {
    const handle = new FakeAgentHandle();
    const store = new InMemoryTaskStore();
    const occ = new OccAcpAgent({ handle, store });
    const created = await occ.newSession({ cwd: "/tmp", mcpServers: [] });
    await expect(
      occ.setSessionMode({ sessionId: created.sessionId, modeId: "yolo" }),
    ).rejects.toThrow(/Unknown mode/);
    await occ.setSessionMode({ sessionId: created.sessionId, modeId: "read-only" });
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
    return {
      sessionId: "blocking-session",
      agentId: this.agentId,
      cwd: opts.cwd ?? "/tmp",
      createdAt: new Date().toISOString(),
    };
  }

  prompt(session: Session, request: PromptRequest): Promise<DelegationResult> {
    const task = this.store.create({
      sessionId: session.sessionId,
      agentId: this.agentId,
      request,
    });
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

describe("OccAcpAgent cancel routing", () => {
  it("session/cancel aborts the in-flight task and the turn ends cancelled", async () => {
    const store = new InMemoryTaskStore();
    const handle = new BlockingHandle(store);
    const occ = new OccAcpAgent({ handle, store });
    const notifyCalls: string[] = [];
    const client = {
      notify: async (_method: string, params: unknown) => {
        notifyCalls.push(JSON.stringify(params));
      },
    };

    const created = await occ.newSession({ cwd: "/tmp", mcpServers: [] });
    const pending = occ.prompt(
      { sessionId: created.sessionId, prompt: [{ type: "text", text: "long work" }] },
      client,
    );
    await new Promise((resolve) => setImmediate(resolve));
    await occ.cancel({ sessionId: created.sessionId });
    const response = await pending;

    expect(response.stopReason).toBe("cancelled");
    expect(handle.cancelledTaskId).toBeTruthy();
    expect(store.get(handle.cancelledTaskId as string)?.status).toBe("cancelled");
    expect(notifyCalls.some((call) => call.includes('"cancelled"'))).toBe(true);
  });
});

describe("promptText", () => {
  it("flattens text, resource links and embedded resources", () => {
    const text = promptText([
      { type: "text", text: "hello" },
      { type: "resource_link", uri: "file:///a.ts", name: "a.ts", mimeType: null, title: null, description: null, size: null, annotations: null, _meta: null },
      { type: "resource", resource: { uri: "file:///b.ts", mimeType: "text/plain", text: "contents of b" }, annotations: null, _meta: null },
    ] as acp.ContentBlock[]);
    expect(text).toContain("hello");
    expect(text).toContain("file:///a.ts");
    expect(text).toContain("contents of b");
  });
});
