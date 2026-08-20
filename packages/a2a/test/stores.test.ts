import { mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Role, TaskState, type Task } from "@a2a-js/sdk";
import { ServerCallContext } from "@a2a-js/sdk/server";
import { newTaskId } from "@occ/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileTaskStore, NormalizedTaskStore } from "../src/stores.js";

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "occ-a2a-store-test-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

const ctx = (): ServerCallContext => new ServerCallContext();

function makeTask(state: TaskState, timestamp?: string): Task {
  return {
    id: newTaskId(),
    contextId: newTaskId(),
    status: { state, message: undefined, timestamp: timestamp ?? new Date().toISOString() },
    artifacts: [
      {
        artifactId: newTaskId(),
        name: "result",
        description: "",
        parts: [{ content: { $case: "text", value: "payload" }, metadata: undefined, filename: "", mediaType: "text/plain" }],
        metadata: undefined,
        extensions: [],
      },
    ],
    history: [
      {
        messageId: newTaskId(),
        contextId: "",
        taskId: "",
        role: Role.ROLE_USER,
        parts: [{ content: { $case: "text", value: "brief" }, metadata: undefined, filename: "", mediaType: "text/plain" }],
        metadata: undefined,
        extensions: [],
        referenceTaskIds: [],
      },
    ],
    metadata: undefined,
  };
}

describe("FileTaskStore", () => {
  it("round-trips save/load/list", async () => {
    const store = new FileTaskStore(join(workDir, "tasks.json"));
    const task = makeTask(TaskState.TASK_STATE_COMPLETED);
    await store.save(task, ctx());

    const loaded = await store.load(task.id, ctx());
    expect(loaded?.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
    expect(loaded?.artifacts[0]?.parts[0]?.content).toMatchObject({ $case: "text", value: "payload" });

    const listed = await store.list(
      { tenant: "", contextId: "", status: TaskState.TASK_STATE_UNSPECIFIED, pageToken: "" },
      ctx(),
    );
    expect(listed.tasks.length).toBe(1);
  });

  it("hydrates from disk after a simulated restart", async () => {
    const path = join(workDir, "tasks.json");
    const task = makeTask(TaskState.TASK_STATE_COMPLETED);
    await new FileTaskStore(path).save(task, ctx());

    // New instance over the same file == process restart.
    const restarted = new FileTaskStore(path);
    const loaded = await restarted.load(task.id, ctx());
    expect(loaded?.id).toBe(task.id);
    expect(loaded?.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);

    const listed = await restarted.list(
      { tenant: "", contextId: "", status: TaskState.TASK_STATE_UNSPECIFIED, pageToken: "" },
      ctx(),
    );
    expect(listed.tasks.map((t) => t.id)).toContain(task.id);
  });

  it("preserves in-flight WORKING tasks across a crash", async () => {
    const path = join(workDir, "tasks.json");
    const task = makeTask(TaskState.TASK_STATE_WORKING);
    await new FileTaskStore(path).save(task, ctx());

    const restarted = new FileTaskStore(path);
    const loaded = await restarted.load(task.id, ctx());
    expect(loaded?.status?.state).toBe(TaskState.TASK_STATE_WORKING);
  });

  it("quarantines an unreadable file instead of crashing", () => {
    const path = join(workDir, "tasks.json");
    writeFileSync(path, "{ not json !!!");

    const store = new FileTaskStore(path);
    expect(store).toBeDefined();
    const quarantined = readdirSync(workDir).filter((f) => f.startsWith("tasks.json.corrupt-"));
    expect(quarantined.length).toBe(1);
  });

  it("prunes terminal tasks older than the TTL at hydration", async () => {
    const path = join(workDir, "tasks.json");
    const old = makeTask(TaskState.TASK_STATE_COMPLETED, new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString());
    const recent = makeTask(TaskState.TASK_STATE_COMPLETED);
    const working = makeTask(TaskState.TASK_STATE_WORKING, new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString());
    const first = new FileTaskStore(path);
    await first.save(old, ctx());
    await first.save(recent, ctx());
    await first.save(working, ctx());

    const restarted = new FileTaskStore(path);
    expect(await restarted.load(old.id, ctx())).toBeUndefined();
    expect((await restarted.load(recent.id, ctx()))?.id).toBe(recent.id);
    // Non-terminal tasks are never pruned, regardless of age.
    expect((await restarted.load(working.id, ctx()))?.id).toBe(working.id);
  });

  it("writes valid JSON on every save (atomic tmp+rename)", async () => {
    const path = join(workDir, "tasks.json");
    const store = new FileTaskStore(path);
    await store.save(makeTask(TaskState.TASK_STATE_WORKING), ctx());
    await store.save(makeTask(TaskState.TASK_STATE_COMPLETED), ctx());

    const onDisk = JSON.parse(readFileSync(path, "utf8")) as { version: number; tasks: unknown[] };
    expect(onDisk.version).toBe(1);
    expect(onDisk.tasks.length).toBe(2);
  });
});

describe("NormalizedTaskStore", () => {
  it("treats TASK_STATE_UNSPECIFIED as no filter", async () => {
    const store = new NormalizedTaskStore();
    await store.save(makeTask(TaskState.TASK_STATE_COMPLETED), ctx());
    const listed = await store.list(
      { tenant: "", contextId: "", status: TaskState.TASK_STATE_UNSPECIFIED, pageToken: "" },
      ctx(),
    );
    expect(listed.tasks.length).toBe(1);
  });
});
