import { afterEach, describe, expect, it } from "vitest";
import {
  agyEffort,
  buildHeadlessArgs,
  printTimeoutFlag,
  resolveAgyBin,
} from "../src/spawn-args.js";

describe("buildHeadlessArgs", () => {
  it("maps workspace-write to accept-edits json -p, no cwd flag", () => {
    expect(
      buildHeadlessArgs({
        cwd: "/tmp/repo",
        brief: "Reply with PING",
        sandbox: "workspace-write",
        timeoutMs: 600_000,
      }),
    ).toEqual([
      "-p",
      "Reply with PING",
      "--output-format",
      "json",
      "--print-timeout",
      "600s",
      "--mode",
      "accept-edits",
    ]);
  });

  it("maps read-only to plan and danger to skip-permissions", () => {
    const ro = buildHeadlessArgs({
      cwd: "/tmp/repo",
      brief: "investigate",
      sandbox: "read-only",
      timeoutMs: 30_000,
      model: "gemini-3.5-flash-medium",
      effort: "xhigh",
      resumeSessionId: "conv-123",
    });
    expect(ro).toContain("--mode");
    expect(ro[ro.indexOf("--mode") + 1]).toBe("plan");
    expect(ro).not.toContain("--dangerously-skip-permissions");
    expect(ro).not.toContain("--cwd");
    expect(ro[ro.indexOf("--model") + 1]).toBe("gemini-3.5-flash-medium");
    expect(ro[ro.indexOf("--effort") + 1]).toBe("high");
    expect(ro[ro.indexOf("--conversation") + 1]).toBe("conv-123");

    const danger = buildHeadlessArgs({
      cwd: "/tmp/repo",
      brief: "go",
      sandbox: "danger-full-access",
      timeoutMs: 1000,
    });
    expect(danger).toContain("--dangerously-skip-permissions");
    expect(danger).toContain("accept-edits");
  });

  it("does not resume pending session ids", () => {
    const args = buildHeadlessArgs({
      cwd: "/tmp/repo",
      brief: "start",
      sandbox: "workspace-write",
      timeoutMs: 1000,
      resumeSessionId: "pending_abc",
    });
    expect(args).not.toContain("--conversation");
  });

  it("defaults to agy, not gemini", () => {
    const previous = process.env.AGY_BIN;
    delete process.env.AGY_BIN;
    try {
      expect(resolveAgyBin()).toBe("agy");
    } finally {
      if (previous === undefined) delete process.env.AGY_BIN;
      else process.env.AGY_BIN = previous;
    }
  });
});

describe("helpers", () => {
  afterEach(() => {
    delete process.env.AGY_BIN;
  });

  it("honours AGY_BIN and maps effort", () => {
    process.env.AGY_BIN = "/opt/agy";
    expect(resolveAgyBin()).toBe("/opt/agy");
    expect(agyEffort("low")).toBe("low");
    expect(agyEffort("max")).toBe("high");
    expect(printTimeoutFlag(1500)).toBe("2s");
  });
});
