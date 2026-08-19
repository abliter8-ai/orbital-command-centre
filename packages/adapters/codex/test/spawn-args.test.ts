import { describe, expect, it } from "vitest";
import { buildCodexExecArgs } from "../src/spawn-args.js";

describe("buildCodexExecArgs", () => {
  it("builds a new-session exec command", () => {
    expect(
      buildCodexExecArgs({
        cwd: "/tmp/repo",
        brief: "Reply with PING",
        sandbox: "workspace-write",
        lastMessagePath: "/tmp/last.txt",
      }),
    ).toEqual([
      "exec",
      "--json",
      "--skip-git-repo-check",
      "--cd",
      "/tmp/repo",
      "--approve-for-me",
      "-o",
      "/tmp/last.txt",
      "--",
      "Reply with PING",
    ]);
  });

  it("resumes a real thread id and passes model", () => {
    const args = buildCodexExecArgs({
      cwd: "/tmp/repo",
      brief: "continue",
      sandbox: "read-only",
      model: "gpt-5.6-luna",
      effort: "high",
      resumeSessionId: "0199a213-81c0-7800-8aa1-bbab2a035a53",
      lastMessagePath: "/tmp/last.txt",
    });
    expect(args.slice(0, 3)).toEqual([
      "exec",
      "resume",
      "0199a213-81c0-7800-8aa1-bbab2a035a53",
    ]);
    expect(args).toContain("-m");
    expect(args).toContain("gpt-5.6-luna");
    expect(args).toContain("--sandbox");
    expect(args).toContain("read-only");
    expect(args).toContain("-c");
    expect(args).toContain('model_reasoning_effort="high"');
    expect(args).not.toContain("--approve-for-me");
    expect(args).not.toContain("--full-auto");
    expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
  });

  it("does not resume pending session ids", () => {
    const args = buildCodexExecArgs({
      cwd: "/tmp/repo",
      brief: "start",
      sandbox: "workspace-write",
      resumeSessionId: "pending_abc",
      lastMessagePath: "/tmp/last.txt",
    });
    expect(args).not.toContain("resume");
  });
});
