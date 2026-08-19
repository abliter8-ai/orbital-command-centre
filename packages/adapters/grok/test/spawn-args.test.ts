import { afterEach, describe, expect, it } from "vitest";
import { buildHeadlessArgs, grokSandboxFlag, grokSpawnEnv, resolveGrokBin } from "../src/spawn-args.js";

describe("buildHeadlessArgs", () => {
  it("maps workspace-write to always-approve json -p, not OS sandbox", () => {
    expect(
      buildHeadlessArgs({
        cwd: "/tmp/repo",
        brief: "Reply with PING",
        sandbox: "workspace-write",
      }),
    ).toEqual([
      "--no-auto-update",
      "--no-alt-screen",
      "--no-leader",
      "--output-format",
      "json",
      "--verbatim",
      "--always-approve",
      "-p",
      "Reply with PING",
    ]);
  });

  it("maps read-only to no always-approve and never passes --sandbox", () => {
    expect(grokSandboxFlag("read-only")).toBeUndefined();
    expect(grokSandboxFlag("workspace-write")).toBeUndefined();

    const args = buildHeadlessArgs({
      cwd: "/tmp/repo",
      brief: "continue",
      sandbox: "read-only",
      model: "grok-4.6",
      effort: "high",
      resumeSessionId: "sess-123",
    });
    expect(args).toContain("--no-leader");
    expect(args).not.toContain("--sandbox");
    expect(args).not.toContain("--always-approve");
    expect(args).not.toContain("--cwd");
    expect(args[args.indexOf("-m") + 1]).toBe("grok-4.6");
    expect(args[args.indexOf("--effort") + 1]).toBe("high");
    expect(args[args.indexOf("-r") + 1]).toBe("sess-123");
    expect(args.at(-2)).toBe("-p");
    expect(args).not.toContain("agent");
    expect(args).not.toContain("acp");
  });

  it("defaults to grok, not agent", () => {
    const previous = process.env.GROK_BIN;
    delete process.env.GROK_BIN;
    try {
      expect(resolveGrokBin()).toBe("grok");
    } finally {
      if (previous === undefined) delete process.env.GROK_BIN;
      else process.env.GROK_BIN = previous;
    }
  });

  it("does not resume pending session ids", () => {
    const args = buildHeadlessArgs({
      cwd: "/tmp/repo",
      brief: "start",
      sandbox: "workspace-write",
      resumeSessionId: "pending_abc",
    });
    expect(args).not.toContain("-r");
  });
});

describe("resolveGrokBin", () => {
  const previous = process.env.GROK_BIN;

  afterEach(() => {
    if (previous === undefined) delete process.env.GROK_BIN;
    else process.env.GROK_BIN = previous;
  });

  it("honours GROK_BIN", () => {
    process.env.GROK_BIN = "/opt/grok";
    expect(resolveGrokBin()).toBe("/opt/grok");
  });
});

describe("grokSpawnEnv", () => {
  it("strips nested Grok session vars so a child does not attach to the parent", () => {
    const env = grokSpawnEnv({
      PATH: "/usr/bin",
      GROK_AGENT: "1",
      GROK_SESSION_ID: "parent-session",
      GROK_AGENT_NAME: "nested",
      HOME: "/Users/roo",
    });
    expect(env.GROK_AGENT).toBeUndefined();
    expect(env.GROK_SESSION_ID).toBeUndefined();
    expect(env.GROK_AGENT_NAME).toBeUndefined();
    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/Users/roo");
  });
});
