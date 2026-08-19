import type { Server } from "node:http";
import { Role, TaskState, type Message, type Task } from "@a2a-js/sdk";
import { ClientFactory } from "@a2a-js/sdk/client";
import { FakeAgentHandle, InMemoryTaskStore, newTaskId } from "@occ/core";
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
});
