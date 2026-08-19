import { describe, expect, it } from "vitest";
import { buildHeadlessArgs } from "../src/spawn-args.js";

describe("buildHeadlessArgs", () => {
  it("maps read-only to ask mode + json", () => {
    expect(
      buildHeadlessArgs({
        cwd: "/tmp/repo",
        sandbox: "read-only",
      }),
    ).toEqual([
      "-p",
      "--output-format",
      "json",
      "--model",
      "auto",
      "--mode",
      "ask",
      "--force",
      "--workspace",
      "/tmp/repo",
    ]);
  });

  it("maps workspace-write to force+trust and stream-json", () => {
    const args = buildHeadlessArgs({
      cwd: "/tmp/repo",
      sandbox: "workspace-write",
      model: "gpt-5.5-medium",
    });
    expect(args).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--stream-partial-output",
      "--model",
      "gpt-5.5-medium",
      "--force",
      "--trust",
      "--workspace",
      "/tmp/repo",
    ]);
    expect(args).not.toContain("--yolo");
    expect(args).not.toContain("acp");
  });

  it("maps danger-full-access to sandbox disabled and resumes real ids", () => {
    const args = buildHeadlessArgs({
      cwd: "/tmp/repo",
      sandbox: "danger-full-access",
      resumeSessionId: "sess-123",
    });
    expect(args).toContain("--sandbox");
    expect(args[args.indexOf("--sandbox") + 1]).toBe("disabled");
    expect(args[args.indexOf("--resume") + 1]).toBe("sess-123");
  });

  it("does not resume pending session ids", () => {
    const args = buildHeadlessArgs({
      cwd: "/tmp/repo",
      sandbox: "read-only",
      resumeSessionId: "pending_abc",
    });
    expect(args).not.toContain("--resume");
  });
});
