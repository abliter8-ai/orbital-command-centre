import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { FakeAgentHandle, type DelegationResult, type PromptRequest, type Session } from "@occ/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuditLog } from "../src/audit.js";
import { WorktreeHandle, sweepStaleWorktrees } from "../src/worktree.js";

const execFileAsync = promisify(execFile);

async function git(repo: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repo, ...args]);
  return stdout.trim();
}

async function makeRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "occ-wt-repo-"));
  await git(repo, ["init", "-q"]);
  await writeFile(join(repo, "README.md"), "# fixture\n");
  await git(repo, ["add", "."]);
  await git(repo, ["-c", "user.name=occ-test", "-c", "user.email=occ@test", "commit", "-qm", "init"]);
  return repo;
}

/** Records the cwd it was prompted in and writes a marker file there. */
class WritingHandle extends FakeAgentHandle {
  seenCwd?: string;

  override async prompt(session: Session, _request: PromptRequest): Promise<DelegationResult> {
    this.seenCwd = session.cwd;
    await writeFile(join(session.cwd, "marker.txt"), "written by agent\n");
    return { ...this.canned, status: "succeeded", cwd: session.cwd };
  }
}

describe("WorktreeHandle", () => {
  let repo: string;
  let rootDir: string;
  let auditFile: string;

  beforeEach(async () => {
    repo = await makeRepo();
    rootDir = await mkdtemp(join(tmpdir(), "occ-wt-root-"));
    auditFile = join(rootDir, "audit.jsonl");
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
    await rm(rootDir, { recursive: true, force: true });
  });

  function deps(inner?: WritingHandle) {
    const handle = inner ?? new WritingHandle();
    const audit = new AuditLog(auditFile);
    const wt = new WorktreeHandle(handle, { audit, rootDir });
    return { handle, audit, wt };
  }

  it("runs the delegation in a detached worktree and cleans it up", async () => {
    const { handle, wt } = deps();
    const session = await wt.startSession({ cwd: repo });
    const result = await wt.prompt(session, { brief: "write marker" });

    expect(result.status).toBe("succeeded");
    // The agent ran somewhere else entirely…
    expect(handle.seenCwd).toBeDefined();
    expect(handle.seenCwd).not.toBe(repo);
    expect(handle.seenCwd!.startsWith(rootDir)).toBe(true);
    // …but the result reports the caller's repo.
    expect(result.cwd).toBe(repo);
    // The marker never touched the real repo, and the worktree is gone.
    await expect(readFile(join(repo, "marker.txt"), "utf8")).rejects.toThrow();
    await expect(readdir(handle.seenCwd!)).rejects.toThrow();
    // No manifest left behind.
    const left = await readdir(rootDir);
    expect(left.filter((f) => f.endsWith(".json"))).toEqual([]);
    // Git agrees: no worktrees but the main one.
    const listed = await git(repo, ["worktree", "list", "--porcelain"]);
    expect(listed.match(/worktree /g)).toHaveLength(1);
  });

  it("fails cleanly when cwd is not a git repo", async () => {
    const { handle, wt } = deps();
    const plain = await mkdtemp(join(tmpdir(), "occ-wt-plain-"));
    try {
      const session = await wt.startSession({ cwd: plain });
      const result = await wt.prompt(session, { brief: "x" });
      expect(result.status).toBe("failed");
      expect(result.error?.code).toBe("invalid_cwd");
      expect(result.error?.message).toMatch(/not inside a git repository/);
      expect(handle.seenCwd).toBeUndefined();
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
  });

  it("writes worktree.create/remove audit events", async () => {
    const { audit, wt } = deps();
    const session = await wt.startSession({ cwd: repo });
    await wt.prompt(session, { brief: "write marker" });
    const events = audit.read(10).filter((e) => e.event);
    expect(events.map((e) => e.event)).toEqual(["worktree.create", "worktree.remove"]);
    expect(events[0]?.detail).toContain(repo);
  });

  it("sweeps worktrees orphaned by a crashed daemon", async () => {
    // Simulate a crash: worktree + manifest exist, nobody cleaned up.
    const orphan = join(rootDir, "codex-orphan-1");
    await git(repo, ["worktree", "add", "--detach", orphan, "HEAD"]);
    await writeFile(
      join(rootDir, "codex-orphan-1.json"),
      JSON.stringify({ path: orphan, repo, agentId: "codex", createdAt: new Date().toISOString() }),
    );

    const audit = new AuditLog(auditFile);
    const removed = await sweepStaleWorktrees(rootDir, audit);
    expect(removed).toBe(1);
    await expect(readdir(orphan)).rejects.toThrow();
    const listed = await git(repo, ["worktree", "list", "--porcelain"]);
    expect(listed.match(/worktree /g)).toHaveLength(1);
    expect(audit.read(5).some((e) => e.event === "worktree.sweep")).toBe(true);
  });
});
