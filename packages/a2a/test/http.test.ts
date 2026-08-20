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

  it("ListTasks discovers tasks without a status filter (SDK UNSPECIFIED-filter bug)", async () => {
    const base = await startTestServer();
    const rpc = async (method: string, params: unknown, id = 1): Promise<Record<string, unknown>> => {
      const res = await fetch(`${base}/rpc`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      });
      return (await res.json()) as Record<string, unknown>;
    };

    await rpc("SendMessage", {
      message: { messageId: newTaskId(), role: "user", parts: [{ text: "hi" }] },
    });

    const listed = (await rpc("ListTasks", { includeArtifacts: true }, 2)) as {
      result?: { tasks?: Array<{ id: string; status?: { state?: string }; artifacts?: unknown[] }> };
    };
    expect(listed.result?.tasks?.length).toBe(1);
    const task = listed.result?.tasks?.[0];
    expect(task?.status?.state).toBe("TASK_STATE_COMPLETED");
    expect(task?.artifacts?.length).toBe(1);

    // A status filter that matches still works; one that doesn't returns empty.
    const match = (await rpc("ListTasks", { status: "TASK_STATE_COMPLETED" }, 3)) as {
      result?: { tasks?: unknown[] };
    };
    expect(match.result?.tasks?.length).toBe(1);
    const noMatch = (await rpc("ListTasks", { status: "TASK_STATE_FAILED" }, 4)) as {
      result?: { tasks?: unknown[] };
    };
    expect(noMatch.result?.tasks?.length ?? 0).toBe(0);
  });

  it("re-attaches with GetTask after the SendMessage client disconnects", async () => {
    // Slow handle: stays in-flight while the client drops.
    class SlowFake extends FakeAgentHandle {
      override async prompt(session: Session, request: PromptRequest): Promise<DelegationResult> {
        this.prompts.push({ session, request });
        await new Promise((resolve) => setTimeout(resolve, 400));
        return { ...this.canned, sessionId: session.sessionId, cwd: session.cwd };
      }
    }
    const handle = new SlowFake({ output: "late result", summary: "done" });
    const store = new InMemoryTaskStore();
    const card = buildAgentCard("codex", "http://127.0.0.1");
    server = createA2aHttpServer({ card, executor: new OccAgentExecutor({ handle, store }) });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no address");
    const base = `http://127.0.0.1:${address.port}`;

    // Client aborts mid-run — the server keeps executing.
    const controller = new AbortController();
    const inflight = fetch(`${base}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "SendMessage",
        params: { message: { messageId: newTaskId(), role: "user", parts: [{ text: "slow" }] } },
      }),
      signal: controller.signal,
    }).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 100));
    controller.abort();
    await inflight;

    // Discover the task via ListTasks (no id known — the response never arrived).
    await new Promise((resolve) => setTimeout(resolve, 500));
    const listRes = await fetch(`${base}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ListTasks", params: { includeArtifacts: true } }),
    });
    const listed = (await listRes.json()) as {
      result?: { tasks?: Array<{ id: string; status?: { state?: string } }> };
    };
    expect(listed.result?.tasks?.length).toBe(1);
    const taskId = listed.result?.tasks?.[0]?.id ?? "";

    const getRes = await fetch(`${base}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "GetTask", params: { id: taskId } }),
    });
    const got = (await getRes.json()) as {
      result?: { status?: { state?: string }; artifacts?: Array<{ parts?: Array<{ text?: string }> }> };
    };
    expect(got.result?.status?.state).toBe("TASK_STATE_COMPLETED");
    expect(got.result?.artifacts?.[0]?.parts?.[0]?.text).toBe("late result");
  });

  it("normalizes spec-style message roles so history keeps ROLE_USER", async () => {
    const base = await startTestServer();
    const res = await fetch(`${base}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "SendMessage",
        params: { message: { messageId: newTaskId(), role: "user", parts: [{ text: "hi" }] } },
      }),
    });
    const body = (await res.json()) as {
      result?: { task?: { history?: Array<{ role?: string }> } };
    };
    expect(body.result?.task?.history?.[0]?.role).toBe("ROLE_USER");
  });
});
