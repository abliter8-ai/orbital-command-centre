import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentRegistry,
  FakeAgentHandle,
  InMemoryTaskStore,
  type DelegationResult,
} from "@occ/core";
import type {
  GrokImagineOptions,
  GrokVideoOptions,
  GrokXSearchOptions,
} from "@occ/adapter-grok";
import { describe, expect, it } from "vitest";
import { defaultCatalog } from "../src/catalog.js";
import { nativeCapabilities } from "../src/capabilities.js";
import {
  buildDelegateDescriptions,
  formatModelSection,
  isAgyResearchHandle,
  isCodexReviewHandle,
  isGrokNativeHandle,
  runAgyResearch,
  runCancel,
  runCodexReview,
  runDelegate,
  runDelegateToCodex,
  runGrokImagine,
  runGrokVideo,
  runGrokXSearch,
  runHealth,
  runListTasks,
  runModels,
  type AgyResearchOptions,
  type CodexReviewOptions,
} from "../src/tools.js";
import type { Session } from "@occ/core";

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

  it("delegates to an injected antigravity handle", async () => {
    const { registry, store } = deps(new FakeAgentHandle({ agentId: "antigravity" }));
    const result = await runDelegate(registry, store, "antigravity", {
      brief: "use agy",
    });
    expect(result.agentId).toBe("antigravity");
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

describe("runListTasks / runCancel", () => {
  it("lists running tasks with trimmed briefs", async () => {
    const { registry, store } = deps();
    const created = store.create({
      sessionId: "sess-1",
      agentId: "codex",
      request: { brief: `x`.repeat(500), sandbox: "read-only" },
    });
    store.markRunning(created.taskId);
    void registry;

    const all = runListTasks(store);
    expect(all.tasks).toHaveLength(1);
    expect(all.tasks[0]?.taskId).toBe(created.taskId);
    expect(all.tasks[0]?.status).toBe("running");
    expect(all.tasks[0]?.brief.length).toBeLessThanOrEqual(161);

    const none = runListTasks(store, { status: ["succeeded"] });
    expect(none.tasks).toHaveLength(0);
  });

  it("cancels a running task through the owning handle", async () => {
    const { registry, store, handle } = deps();
    const created = store.create({
      sessionId: "sess-1",
      agentId: "codex",
      request: { brief: "long running" },
    });
    store.markRunning(created.taskId);

    const result = await runCancel(registry, store, created.taskId);
    expect(result.ok).toBe(true);
    expect(result.status).toBe("cancelled");
    expect(handle.cancelledTaskIds).toEqual([created.taskId]);
    expect(store.get(created.taskId)?.status).toBe("cancelled");
  });

  it("refuses to cancel unknown or finished tasks", async () => {
    const { registry, store, handle } = deps();

    const unknown = await runCancel(registry, store, "task_missing");
    expect(unknown.ok).toBe(false);
    expect(unknown.error?.code).toBe("unknown_task");

    const created = store.create({
      sessionId: "sess-1",
      agentId: "codex",
      request: { brief: "done already" },
    });
    store.cancel(created.taskId);
    const finished = await runCancel(registry, store, created.taskId);
    expect(finished.ok).toBe(false);
    expect(finished.error?.code).toBe("not_running");
    expect(handle.cancelledTaskIds).toHaveLength(0);
  });
});

describe("model catalog in tools", () => {
  it("runModels reports staleness for the built-in defaults", () => {
    const models = runModels(defaultCatalog(), "/tmp/occ-test-catalog.json");
    expect(models.stale).toBe(true);
    expect(models.agents.map((agent) => agent.agentId)).toEqual([
      "codex",
      "cursor",
      "grok",
      "antigravity",
    ]);
  });

  it("formatModelSection marks static fallbacks and live entries", () => {
    const catalog = defaultCatalog();
    expect(formatModelSection(catalog.agents.grok)).toMatch(/built-in fallback/i);

    catalog.agents.grok = {
      agentId: "grok",
      fetchedAt: "2026-08-19T15:00:00.000Z",
      cliVersion: "1.0.5",
      defaultModel: "grok-4.6",
      models: ["grok-4.6", "dsv4-think-max"],
      source: "live",
    };
    const section = formatModelSection(catalog.agents.grok);
    expect(section).toContain("dsv4-think-max");
    expect(section).toContain("CLI 1.0.5");
    expect(section).not.toMatch(/built-in fallback/i);
  });

  it("buildDelegateDescriptions injects catalog slugs and keeps cautions", () => {
    const catalog = defaultCatalog();
    catalog.agents.cursor = {
      agentId: "cursor",
      fetchedAt: "2026-08-19T15:00:00.000Z",
      cliVersion: "2026.08.11-e8db854",
      defaultModel: "auto",
      models: ["auto", "composer-2.5", "claude-opus-5-thinking-high"],
      source: "live",
    };
    const descriptions = buildDelegateDescriptions(catalog);
    expect(descriptions.cursor).toContain("composer-2.5");
    expect(descriptions.cursor).toContain("effort=high");
    expect(descriptions.codex).toContain("gpt-5.1-codex");
    expect(descriptions.antigravity).toContain("hard ERROR");
    expect(descriptions.grok).toContain("--effort");
  });
});

class FakeGrokNativeHandle extends FakeAgentHandle {
  readonly calls: { kind: string; opts: unknown }[] = [];

  constructor() {
    super({ agentId: "grok", summary: "grok native canned", output: "grok native canned" });
  }

  private cannedNative(): DelegationResult {
    return { ...this.canned, agentId: "grok", status: "succeeded" };
  }

  async xSearch(opts: GrokXSearchOptions): Promise<DelegationResult> {
    this.calls.push({ kind: "xSearch", opts });
    return this.cannedNative();
  }

  async imagine(opts: GrokImagineOptions): Promise<DelegationResult> {
    this.calls.push({ kind: "imagine", opts });
    return this.cannedNative();
  }

  async animateVideo(opts: GrokVideoOptions): Promise<DelegationResult> {
    this.calls.push({ kind: "animateVideo", opts });
    return this.cannedNative();
  }
}

describe("grok native tools", () => {
  function nativeDeps() {
    const handle = new FakeGrokNativeHandle();
    const registry = new AgentRegistry();
    registry.register(handle);
    return { registry, store: new InMemoryTaskStore(), handle };
  }

  it("detects the structural native interface", () => {
    expect(isGrokNativeHandle(new FakeGrokNativeHandle())).toBe(true);
    expect(isGrokNativeHandle(new FakeAgentHandle({ agentId: "grok" }))).toBe(false);
    expect(isGrokNativeHandle(new FakeAgentHandle({ agentId: "codex" }))).toBe(false);
  });

  it("routes x_search with translated options and records the task", async () => {
    const { registry, store, handle } = nativeDeps();
    const result = await runGrokXSearch(registry, store, {
      query: "from:AnthropicAI Claude",
      cwd: "/tmp",
      mode: "Top",
      limit: 5,
      excludeReplies: true,
    });
    expect(result.status).toBe("succeeded");
    expect(handle.calls[0]?.kind).toBe("xSearch");
    expect(handle.calls[0]?.opts).toMatchObject({ mode: "Top", limit: 5, excludeReplies: true });
    expect(store.get(result.taskId)?.status).toBe("succeeded");
  });

  it("routes imagine and video", async () => {
    const { registry, store, handle } = nativeDeps();
    await runGrokImagine(registry, store, { prompt: "a mug", cwd: "/tmp", aspectRatio: "1:1" });
    await runGrokVideo(registry, store, { sourceImage: "/tmp/a.jpg", cwd: "/tmp", duration: 6 });
    expect(handle.calls.map((call) => call.kind)).toEqual(["imagine", "animateVideo"]);
  });

  it("fails fast when grok is unavailable or lacks native methods", async () => {
    const { registry, store, handle } = nativeDeps();
    handle.available = false;
    const unavailable = await runGrokXSearch(registry, store, { query: "x", cwd: "/tmp" });
    expect(unavailable.error?.code).toBe("not_available");
    expect(handle.calls).toHaveLength(0);

    const plain = new AgentRegistry();
    plain.register(new FakeAgentHandle({ agentId: "grok" }));
    const missing = await runGrokImagine(plain, new InMemoryTaskStore(), {
      prompt: "x",
      cwd: "/tmp",
    });
    expect(missing.error?.code).toBe("agent_failed");
    expect(missing.error?.hint).toMatch(/adapter-grok/);
  });
});

class FakeCodexReviewHandle extends FakeAgentHandle {
  readonly calls: { opts: CodexReviewOptions }[] = [];

  constructor() {
    super({ agentId: "codex", summary: "review canned", output: "review canned" });
  }

  async review(_session: Session, opts: CodexReviewOptions): Promise<DelegationResult> {
    this.calls.push({ opts });
    return { ...this.canned, agentId: "codex", status: "succeeded" };
  }
}

describe("codex_review tool", () => {
  it("detects the structural review interface", () => {
    expect(isCodexReviewHandle(new FakeCodexReviewHandle())).toBe(true);
    expect(isCodexReviewHandle(new FakeAgentHandle({ agentId: "codex" }))).toBe(false);
    expect(isCodexReviewHandle(new FakeGrokNativeHandle())).toBe(false);
  });

  it("routes a review with target and records the task", async () => {
    const handle = new FakeCodexReviewHandle();
    const { registry, store } = deps(handle);
    const result = await runCodexReview(registry, store, {
      target: { kind: "base", branch: "main" },
      prompt: "Focus on auth.",
      cwd: "/tmp",
    });
    expect(result.status).toBe("succeeded");
    expect(handle.calls[0]?.opts.target).toEqual({ kind: "base", branch: "main" });
    expect(store.get(result.taskId)?.status).toBe("succeeded");
  });

  it("fails fast when codex lacks review()", async () => {
    const { registry, store } = deps(new FakeAgentHandle({ agentId: "codex" }));
    const result = await runCodexReview(registry, store, {
      target: { kind: "uncommitted" },
      cwd: "/tmp",
    });
    expect(result.error?.code).toBe("agent_failed");
    expect(result.error?.hint).toMatch(/adapter-codex/);
  });
});

class FakeAgyResearchHandle extends FakeAgentHandle {
  readonly calls: { opts: AgyResearchOptions }[] = [];

  constructor() {
    super({ agentId: "antigravity", summary: "research canned", output: "research canned" });
  }

  async research(_session: Session, opts: AgyResearchOptions): Promise<DelegationResult> {
    this.calls.push({ opts });
    return { ...this.canned, agentId: "antigravity", status: "succeeded" };
  }
}

describe("antigravity_research tool", () => {
  it("detects the structural research interface", () => {
    expect(isAgyResearchHandle(new FakeAgyResearchHandle())).toBe(true);
    expect(isAgyResearchHandle(new FakeAgentHandle({ agentId: "antigravity" }))).toBe(false);
  });

  it("routes research when permissions are in place (skip preflight)", async () => {
    const handle = new FakeAgyResearchHandle();
    const { registry, store } = deps(handle);
    const result = await runAgyResearch(registry, store, {
      question: "What shipped in Node 24?",
      cwd: "/tmp",
      preflight: "skip",
    });
    expect(result.status).toBe("succeeded");
    expect(handle.calls[0]?.opts.question).toBe("What shipped in Node 24?");
    expect(store.get(result.taskId)?.status).toBe("succeeded");
  });

  it("check preflight fails fast with the exact fix when rules are missing", async () => {
    const handle = new FakeAgyResearchHandle();
    const { registry, store } = deps(handle);
    const dir = await mkdtemp(join(tmpdir(), "occ-agy-preflight-"));
    process.env.OCC_AGY_SETTINGS = join(dir, "settings.json");
    try {
      const result = await runAgyResearch(registry, store, {
        question: "x",
        cwd: "/tmp",
        preflight: "check",
      });
      expect(result.status).toBe("failed");
      expect(result.error?.message).toMatch(/soft-denied/);
      expect(result.error?.hint).toMatch(/preflight "fix"/);
      expect(handle.calls).toHaveLength(0);
    } finally {
      delete process.env.OCC_AGY_SETTINGS;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fix preflight writes the allow rule then runs", async () => {
    const handle = new FakeAgyResearchHandle();
    const { registry, store } = deps(handle);
    const dir = await mkdtemp(join(tmpdir(), "occ-agy-preflight-"));
    const settingsPath = join(dir, "settings.json");
    process.env.OCC_AGY_SETTINGS = settingsPath;
    try {
      const result = await runAgyResearch(registry, store, {
        question: "x",
        cwd: "/tmp",
        preflight: "fix",
      });
      expect(result.status).toBe("succeeded");
      expect(handle.calls).toHaveLength(1);
      const written = JSON.parse(await readFile(settingsPath, "utf8")) as {
        permissions: { allow: string[] };
      };
      expect(written.permissions.allow).toContain("read_url(*)");
    } finally {
      delete process.env.OCC_AGY_SETTINGS;
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("nativeCapabilities", () => {
  it("covers all four agents with grok's unique tools first-class", () => {
    const caps = nativeCapabilities();
    expect(Object.keys(caps).sort()).toEqual(["antigravity", "codex", "cursor", "grok"]);
    const grokTools = caps.grok.nativeTools.map((tool) => tool.name);
    expect(grokTools).toContain("x_keyword_search");
    expect(grokTools).toContain("image_to_video / reference_to_video");
    const xSearch = caps.grok.nativeTools.find((tool) => tool.name === "x_keyword_search");
    expect(xSearch?.invoke).toBe("grok_x_search");
    expect(caps.antigravity.nativeTools.some((tool) => tool.name === "google_search")).toBe(true);
    for (const profile of Object.values(caps)) {
      expect(profile.reviewedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
