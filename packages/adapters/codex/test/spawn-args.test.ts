import { describe, expect, it } from "vitest";
import { buildCodexExecArgs, buildCodexReviewArgs } from "../src/spawn-args.js";

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

  it("attaches images with -i before the prompt separator", () => {
    const args = buildCodexExecArgs({
      cwd: "/tmp/repo",
      brief: "What is in these screenshots?",
      sandbox: "read-only",
      images: ["/tmp/a.png", "/tmp/b.png"],
      lastMessagePath: "/tmp/last.txt",
    });
    const i = args.indexOf("-i");
    expect(i).toBeGreaterThan(-1);
    expect(args.slice(i, i + 3)).toEqual(["-i", "/tmp/a.png", "/tmp/b.png"]);
    expect(args.indexOf("-i")).toBeLessThan(args.indexOf("--"));
  });
});

describe("buildCodexReviewArgs", () => {
  it("builds an uncommitted review on the narrow review flag set", () => {
    expect(
      buildCodexReviewArgs({
        target: { kind: "uncommitted" },
        lastMessagePath: "/tmp/last.txt",
      }),
    ).toEqual([
      "exec",
      "review",
      "--json",
      "--skip-git-repo-check",
      "--uncommitted",
      "-o",
      "/tmp/last.txt",
    ]);
  });

  it("supports base, commit, and custom targets with model/effort/prompt", () => {
    const base = buildCodexReviewArgs({
      target: { kind: "base", branch: "main" },
      model: "gpt-5.6-luna",
      effort: "high",
      lastMessagePath: "/tmp/last.txt",
    });
    expect(base).toContain("--base");
    expect(base).toContain("main");
    expect(base).toContain("-m");
    expect(base).toContain('model_reasoning_effort="high"');

    const commit = buildCodexReviewArgs({
      target: { kind: "commit", sha: "abc123" },
      lastMessagePath: "/tmp/last.txt",
    });
    expect(commit).toContain("--commit");
    expect(commit).toContain("abc123");
    expect(commit).not.toContain("--");

    const custom = buildCodexReviewArgs({
      target: { kind: "custom" },
      prompt: "Review packages/core for races.",
      lastMessagePath: "/tmp/last.txt",
    });
    expect(custom).not.toContain("--uncommitted");
    expect(custom.slice(-2)).toEqual(["--", "Review packages/core for races."]);
  });

  it("never mixes a target flag with a custom prompt (the CLI rejects it)", () => {
    const args = buildCodexReviewArgs({
      target: { kind: "uncommitted" },
      prompt: "Focus on auth.",
      lastMessagePath: "/tmp/last.txt",
    });
    expect(args).toContain("--uncommitted");
    expect(args).not.toContain("--");
    expect(args).not.toContain("Focus on auth.");
  });

  it("uses only flags codex exec review actually accepts", () => {
    const args = buildCodexReviewArgs({
      target: { kind: "uncommitted" },
      lastMessagePath: "/tmp/last.txt",
    });
    // The review subcommand rejects --cd, --sandbox, and --approve-for-me.
    expect(args).not.toContain("--cd");
    expect(args).not.toContain("--sandbox");
    expect(args).not.toContain("--approve-for-me");
  });
});
