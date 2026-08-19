import { describe, expect, it } from "vitest";
import { InMemoryTaskStore, UnknownTaskError } from "../src/tasks.js";

describe("InMemoryTaskStore", () => {
  it("creates a queued task, marks it running, and completes with a result", () => {
    const store = new InMemoryTaskStore();
    const created = store.create({
      sessionId: "sess-1",
      agentId: "codex",
      request: { brief: "do the thing" },
    });

    expect(created.status).toBe("queued");
    expect(created.taskId.startsWith("task_")).toBe(true);
    expect(store.get(created.taskId)?.status).toBe("queued");

    const running = store.markRunning(created.taskId);
    expect(running.status).toBe("running");

    const result = {
      taskId: created.taskId,
      sessionId: "sess-1",
      agentId: "codex" as const,
      status: "succeeded" as const,
      cwd: "/tmp/repo",
      summary: "done",
      output: "done",
      filesChanged: [],
      durationMs: 4,
    };
    const completed = store.complete(created.taskId, result);
    expect(completed.status).toBe("succeeded");
    expect(completed.result?.output).toBe("done");
    expect(completed.finishedAt).toBeDefined();
  });

  it("throws UnknownTaskError when cancelling an unknown id", () => {
    const store = new InMemoryTaskStore();
    expect(() => store.cancel("task_missing")).toThrow(UnknownTaskError);
    expect(() => store.cancel("task_missing")).toThrow(/task_missing/);
  });

  it("cancels a known task", () => {
    const store = new InMemoryTaskStore();
    const created = store.create({
      sessionId: "sess-2",
      agentId: "codex",
      request: { brief: "stop me" },
    });
    const cancelled = store.cancel(created.taskId);
    expect(cancelled.status).toBe("cancelled");
    expect(store.get(created.taskId)?.status).toBe("cancelled");
  });

  it("lists tasks newest-first with optional status filter", () => {
    const store = new InMemoryTaskStore();
    const older = store.create({
      sessionId: "sess-a",
      agentId: "codex",
      request: { brief: "first" },
    });
    const newer = store.create({
      sessionId: "sess-b",
      agentId: "grok",
      request: { brief: "second" },
    });
    store.markRunning(newer.taskId);

    const all = store.list();
    expect(all).toHaveLength(2);
    expect(all[0]?.taskId).toBe(newer.taskId);
    expect(all[1]?.taskId).toBe(older.taskId);

    const running = store.list({ status: "running" });
    expect(running.map((task) => task.taskId)).toEqual([newer.taskId]);

    const terminal = store.list({ status: ["succeeded", "failed", "cancelled"] });
    expect(terminal).toHaveLength(0);
  });
});
