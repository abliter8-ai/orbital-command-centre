import {
  AgentRegistry,
  FakeAgentHandle,
  InMemoryTaskStore,
} from "@occ/core";
import { describe, expect, it } from "vitest";
import { runDelegate, runDelegateToCodex, runHealth } from "../src/tools.js";

function deps(handle = new FakeAgentHandle()) {
  const registry = new AgentRegistry();
  registry.register(handle);
  return { registry, store: new InMemoryTaskStore(), handle };
}

describe("runHealth / runDelegateToCodex", () => {
  it("reports injected fake Codex as available", async () => {
    const { registry } = deps();
    const health = await runHealth(registry);
    expect(health.ok).toBe(true);
    expect(health.agents[0]?.id).toBe("codex");
    expect(health.agents[0]?.available).toBe(true);
  });

  it("delegates to the fake handle and stores the result", async () => {
    const { registry, store, handle } = deps(
      new FakeAgentHandle({ summary: "canned success" }),
    );
    const result = await runDelegateToCodex(registry, store, {
      brief: "implement X with tests",
      cwd: "/tmp/work",
      sandbox: "read-only",
    });
    expect(result.status).toBe("succeeded");
    expect(result.summary).toBe("canned success");
    expect(handle.prompts[0]?.request.brief).toBe("implement X with tests");
    expect(handle.prompts[0]?.request.sandbox).toBe("read-only");
    expect(store.get(result.taskId)?.status).toBe("succeeded");
  });

  it("delegates to an injected cursor handle", async () => {
    const { registry, store } = deps(new FakeAgentHandle({ agentId: "cursor" }));
    const result = await runDelegate(registry, store, "cursor", {
      brief: "edit via cursor",
    });
    expect(result.agentId).toBe("cursor");
    expect(result.status).toBe("succeeded");
  });

  it("delegates to an injected grok handle", async () => {
    const { registry, store } = deps(new FakeAgentHandle({ agentId: "grok" }));
    const result = await runDelegate(registry, store, "grok", {
      brief: "search X then summarise",
    });
    expect(result.agentId).toBe("grok");
    expect(result.status).toBe("succeeded");
  });

  it("fails fast when the handle is unavailable", async () => {
    const handle = new FakeAgentHandle();
    handle.available = false;
    const { registry, store } = deps(handle);
    const result = await runDelegateToCodex(registry, store, {
      brief: "nope",
    });
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("not_available");
    expect(handle.prompts).toHaveLength(0);
  });
});
