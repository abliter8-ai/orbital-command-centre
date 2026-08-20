import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { Role, TaskState, type Message, type Task } from "@a2a-js/sdk";
import { ClientFactory } from "@a2a-js/sdk/client";
import { FakeAgentHandle, newTaskId, type AgentHandle, type AgentId } from "@occ/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuditLog } from "../src/audit.js";
import { defaultConfig, sandboxAllowed, type OrbitalConfig } from "../src/config.js";
import { createDaemonServer } from "../src/daemon.js";

let server: Server | undefined;
let workDir: string;
let audit: AuditLog;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "occ-daemon-test-"));
  audit = new AuditLog(join(workDir, "audit.jsonl"));
});

afterEach(async () => {
  if (server) {
    await new Promise((resolve) => server?.close(resolve));
    server = undefined;
  }
  rmSync(workDir, { recursive: true, force: true });
});

function fakeHandles(): Record<AgentId, AgentHandle> {
  return {
    codex: new FakeAgentHandle({ agentId: "codex", output: "codex says hi" }),
    cursor: new FakeAgentHandle({ agentId: "cursor" }),
    grok: new FakeAgentHandle({ agentId: "grok" }),
    antigravity: new FakeAgentHandle({ agentId: "antigravity" }),
  };
}

async function startDaemon(config: OrbitalConfig = defaultConfig()): Promise<string> {
  server = createDaemonServer({
    config,
    handles: fakeHandles(),
    audit,
    tasksDir: join(workDir, "a2a-tasks"),
    probe: async () => ({ available: true, authenticated: true, detail: "test probe" }),
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const address = server?.address();
  if (!address || typeof address === "string") throw new Error("no address");
  return `http://127.0.0.1:${address.port}`;
}

function userMessage(text: string, metadata: Record<string, unknown> = {}): Message {
  return {
    messageId: newTaskId(),
    contextId: "",
    taskId: "",
    role: Role.ROLE_USER,
    parts: [
      { content: { $case: "text", value: text }, metadata: undefined, filename: "", mediaType: "text/plain" },
    ],
    metadata,
    extensions: [],
    referenceTaskIds: [],
  };
}

describe("sandboxAllowed", () => {
  it("orders read-only < workspace-write < danger-full-access", () => {
    expect(sandboxAllowed("read-only", "workspace-write")).toBe(true);
    expect(sandboxAllowed("workspace-write", "read-only")).toBe(false);
    expect(sandboxAllowed("danger-full-access", "workspace-write")).toBe(false);
    expect(sandboxAllowed("workspace-write", "workspace-write")).toBe(true);
  });
});

describe("daemon HTTP surface", () => {
  it("serves health with per-agent availability", async () => {
    const base = await startDaemon();
    const res = await fetch(`${base}/v1/health`);
    const health = (await res.json()) as {
      ok: boolean;
      agents: Record<string, { available: boolean; enabled: boolean }>;
    };
    expect(health.ok).toBe(true);
    expect(health.agents.codex?.available).toBe(true);
    expect(health.agents.grok?.enabled).toBe(true);
  });

  it("serves the registry with models and capabilities", async () => {
    const base = await startDaemon();
    const res = await fetch(`${base}/v1/registry`);
    const registry = (await res.json()) as {
      agents: Record<string, { models: { models: string[] }; capabilities: { nativeTools: unknown[] } }>;
    };
    expect(registry.agents.grok?.models.models.length).toBeGreaterThan(0);
    expect(registry.agents.cursor?.capabilities.nativeTools.length).toBeGreaterThan(0);
  });

  it("round-trips SendMessage through the per-agent mount", async () => {
    const base = await startDaemon();
    const client = await new ClientFactory().createFromUrl(base, "/agents/codex/.well-known/agent-card.json");
    const result = await client.sendMessage({ message: userMessage("say hi") });
    const task = result as Task;
    expect(task.status?.state).toBe(TaskState.TASK_STATE_COMPLETED);
    const part = task.artifacts[0]?.parts[0]?.content;
    expect(part?.$case === "text" && part.value).toBe("codex says hi");

    const entries = audit.read();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.agentId).toBe("codex");
    expect(entries[0]?.status).toBe("succeeded");
  });

  it("rejects a sandbox above the policy cap and audits the rejection", async () => {
    const config = defaultConfig();
    config.agents.grok.maxSandbox = "read-only";
    const base = await startDaemon(config);
    const client = await new ClientFactory().createFromUrl(base, "/agents/grok/.well-known/agent-card.json");
    const result = await client.sendMessage({
      message: userMessage("edit files", { sandbox: "workspace-write" }),
    });
    const task = result as Task;
    expect(task.status?.state).toBe(TaskState.TASK_STATE_FAILED);
    const part = task.status?.message?.parts[0]?.content;
    expect(part?.$case === "text" && part.value).toMatch(/exceeds the policy cap/);

    const entries = audit.read();
    expect(entries[0]?.status).toBe("rejected");
    expect(entries[0]?.error).toMatch(/policy cap/);
  });

  it("rejects a disabled agent before any spawn", async () => {
    const config = defaultConfig();
    config.agents.cursor.enabled = false;
    const base = await startDaemon(config);
    const client = await new ClientFactory().createFromUrl(base, "/agents/cursor/.well-known/agent-card.json");
    const result = await client.sendMessage({ message: userMessage("anything") });
    expect((result as Task).status?.state).toBe(TaskState.TASK_STATE_FAILED);
    expect(audit.read()[0]?.status).toBe("rejected");
  });

  it("serves the audit log over /v1/audit", async () => {
    const base = await startDaemon();
    const client = await new ClientFactory().createFromUrl(base, "/agents/codex/.well-known/agent-card.json");
    await client.sendMessage({ message: userMessage("one") });
    const res = await fetch(`${base}/v1/audit`);
    const body = (await res.json()) as { entries: { agentId: string; status: string }[] };
    expect(body.entries.length).toBe(1);
    expect(body.entries[0]?.status).toBe("succeeded");
  });
});
