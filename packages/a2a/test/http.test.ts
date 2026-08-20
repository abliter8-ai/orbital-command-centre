import type { Server } from "node:http";
import { Role, TaskState, type Message, type Task } from "@a2a-js/sdk";
import { ClientFactory } from "@a2a-js/sdk/client";
import {
  FakeAgentHandle,
  InMemoryTaskStore,
  newTaskId,
  type DelegationResult,
  type PromptRequest,
  type Session,
} from "@occ/core";
import { afterEach, describe, expect, it } from "vitest";
import { buildAgentCard } from "../src/card.js";
import { OccAgentExecutor } from "../src/executor.js";
import { createA2aHttpServer } from "../src/http.js";

let server: Server | undefined;

afterEach(async () => {
  if (server) {
    await new Promise((resolve) => server?.close(resolve));
    server = undefined;
  }
});

async function startTestServer(): Promise<string> {
  const handle = new FakeAgentHandle({ output: "a2a wire result", summary: "done" });
  const store = new InMemoryTaskStore();
  const card = buildAgentCard("codex", "http://127.0.0.1");
  server = createA2aHttpServer({
    card,
    executor: new OccAgentExecutor({ handle, store }),
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no address");
  const base = `http://127.0.0.1:${address.port}`;
  // The client follows the URL inside the card, so it must match the real port.
  const iface = card.supportedInterfaces[0];
  if (iface) iface.url = base;
  return base;
}

describe("A2A HTTP hosting", () => {
  it("serves the agent card on the well-known path", async () => {
    const base = await startTestServer();
    const res = await fetch(`${base}/.well-known/agent-card.json`);
    expect(res.status).toBe(200);
    const card = (await res.json()) as { name: string; skills: unknown[] };
    expect(card.name).toBe("OCC Codex");
    expect(card.skills.length).toBeGreaterThan(1);
  });

  it("round-trips message/send to a completed task with the result artifact", async () => {
    const base = await startTestServer();
    const client = await new ClientFactory().createFromUrl(base);
    const message: Message = {
      messageId: newTaskId(),
      contextId: "",
      taskId: "",
      role: Role.ROLE_USER,
      parts: [
        { content: { $case: "text", value: "Reply with PING" }, metadata: undefined, filename: "", mediaType: "text/plain" },
      ],
      metadata: { sandbox: "read-only" },
      extensions: [],
      referenceTaskIds: [],
    };

    const result = await client.sendMessage({ message });
    const task = result as Task;
    expect(task.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
    const artifactPart = task.artifacts[0]?.parts[0]?.content;
    expect(artifactPart?.$case === "text" && artifactPart.value).toBe("a2a wire result");
  });

  it("streams message/stream as SSE with progressive artifact chunks", async () => {
    class StreamingFake extends FakeAgentHandle {
      override async prompt(session: Session, request: PromptRequest): Promise<DelegationResult> {
        this.prompts.push({ session, request });
        request.onEvent?.({ kind: "tool_start", text: "command_execution" });
        request.onEvent?.({ kind: "text", text: "chunk-one " });
        request.onEvent?.({ kind: "tool_end", text: "command_execution" });
        request.onEvent?.({ kind: "text", text: "chunk-two" });
        return { ...this.canned, sessionId: session.sessionId, cwd: session.cwd };
      }
    }

    const handle = new StreamingFake({ output: "chunk-one chunk-two", summary: "done" });
    const store = new InMemoryTaskStore();
    const card = buildAgentCard("codex", "http://127.0.0.1");
    server = createA2aHttpServer({ card, executor: new OccAgentExecutor({ handle, store }) });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no address");
    const base = `http://127.0.0.1:${address.port}`;

    const res = await fetch(`${base}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "SendStreamingMessage",
        params: {
          message: {
            messageId: newTaskId(),
            role: "ROLE_USER",
            parts: [{ text: "stream me" }],
          },
        },
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const body = await res.text();
    const frames = body
      .split("\n\n")
      .filter((f) => f.trim() !== "")
      .map((f) => f.replace(/^data: /, ""))
      .map((f) => JSON.parse(f) as Record<string, unknown>);

    // Progressive frames: 2 artifact chunks + tool status updates + terminal.
    const payload = JSON.stringify(frames);
    expect(payload).toContain("chunk-one");
    expect(payload).toContain("chunk-two");
    expect(payload).toContain("command_execution");
    expect(frames.length).toBeGreaterThanOrEqual(4);

    // Text chunks arrive before the terminal COMPLETED frame.
    const firstChunk = frames.findIndex((f) => JSON.stringify(f).includes("chunk-one"));
    const terminal = frames.findIndex((f) => JSON.stringify(f).includes("TASK_STATE_COMPLETED"));
    expect(firstChunk).toBeGreaterThanOrEqual(0);
    expect(terminal).toBeGreaterThan(firstChunk);
  });
});
