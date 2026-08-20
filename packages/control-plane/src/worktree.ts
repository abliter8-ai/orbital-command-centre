import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type {
  AgentCapabilities,
  AgentHandle,
  AgentId,
  Availability,
  DelegationResult,
  PromptRequest,
  Session,
  SessionOptions,
} from "@occ/core";
import type { AuditLog } from "./audit.js";

const execFileAsync = promisify(execFile);

/**
 * Worktree isolation: each delegation runs in a fresh `git worktree` detached
 * at HEAD, so the agent can write freely without touching the caller's working
 * tree. The worktree is removed when the delegation ends (success or fail).
 *
 * Caveats, by design:
 * - Uncommitted changes in the caller's tree are NOT visible to the agent
 *   (a worktree starts from a commit).
 * - The agent's edits die with the worktree unless the brief tells the agent
 *   to produce a patch/branch — this is an isolation fence, not a merge
 *   strategy.
 * - Requires the delegation cwd to be inside a git repo.
 */

export function worktreeRoot(): string {
  return process.env.OCC_WORKTREE_ROOT ?? join(homedir(), ".occ", "worktrees");
}

interface WorktreeManifest {
  path: string;
  repo: string;
  agentId: AgentId;
  createdAt: string;
}

async function git(repo: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repo, ...args], { timeout: 15_000 });
  return stdout.trim();
}

async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    return (await git(cwd, ["rev-parse", "--is-inside-work-tree"])) === "true";
  } catch {
    return false;
  }
}

export interface WorktreeHandleOptions {
  audit?: AuditLog;
  rootDir?: string;
}

let counter = 0;

export class WorktreeHandle implements AgentHandle {
  private readonly inner: AgentHandle;
  private readonly audit?: AuditLog;
  private readonly rootDir: string;

  constructor(inner: AgentHandle, opts: WorktreeHandleOptions) {
    this.inner = inner;
    this.audit = opts.audit;
    this.rootDir = opts.rootDir ?? worktreeRoot();
  }

  get agentId(): AgentId {
    return this.inner.agentId;
  }

  get displayName(): string {
    return this.inner.displayName;
  }

  capabilities(): AgentCapabilities {
    return this.inner.capabilities();
  }

  isAvailable(): Promise<Availability> {
    return this.inner.isAvailable();
  }

  startSession(opts: SessionOptions): Promise<Session> {
    return this.inner.startSession(opts);
  }

  cancel(taskId: string): Promise<void> {
    return this.inner.cancel(taskId);
  }

  close(session: Session): Promise<void> {
    return this.inner.close(session);
  }

  private auditEvent(event: string, detail: string, status: string, error?: string): void {
    this.audit?.append({
      ts: new Date().toISOString(),
      agentId: this.agentId,
      a2aTaskId: "-",
      contextId: "-",
      sandbox: "-",
      status,
      durationMs: 0,
      event,
      detail,
      error,
    });
  }

  async prompt(session: Session, request: PromptRequest): Promise<DelegationResult> {
    const repo = session.cwd;
    if (!(await isGitRepo(repo))) {
      return {
        taskId: "task_no_repo",
        sessionId: session.sessionId,
        agentId: this.agentId,
        status: "failed",
        cwd: repo,
        summary: "Worktree isolation requires the delegation cwd to be inside a git repository.",
        output: "",
        filesChanged: [],
        durationMs: 0,
        error: {
          code: "invalid_cwd",
          message: `Worktree isolation: ${repo} is not inside a git repository.`,
          hint: 'Point cwd at a git repo, or set isolation to "none" for this agent in ~/.occ/orbital.json.',
        },
      };
    }

    const id = `${this.agentId}-${Date.now()}-${counter++}`;
    const worktreePath = join(this.rootDir, id);
    const manifestPath = join(this.rootDir, `${id}.json`);

    await mkdir(this.rootDir, { recursive: true });
    await git(repo, ["worktree", "add", "--detach", worktreePath, "HEAD"]);
    const manifest: WorktreeManifest = {
      path: worktreePath,
      repo,
      agentId: this.agentId,
      createdAt: new Date().toISOString(),
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
    this.auditEvent("worktree.create", `${worktreePath} (repo ${repo})`, "succeeded");

    try {
      const isolated: Session = { ...session, cwd: worktreePath };
      const result = await this.inner.prompt(isolated, request);
      // Report the repo the caller asked about, not the throwaway path.
      return { ...result, cwd: repo };
    } finally {
      const removed = await removeWorktree(repo, worktreePath);
      await rm(manifestPath, { force: true });
      this.auditEvent(
        "worktree.remove",
        worktreePath,
        removed ? "succeeded" : "failed",
        removed ? undefined : "git worktree remove failed; directory left behind",
      );
    }
  }
}

async function removeWorktree(repo: string, path: string): Promise<boolean> {
  try {
    await git(repo, ["worktree", "remove", "--force", path]);
    return true;
  } catch {
    try {
      await rm(path, { recursive: true, force: true });
      await git(repo, ["worktree", "prune"]);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Remove worktrees left behind by a crashed daemon. Manifests under the root
 * name the source repo, so each can be deregistered properly. Called once at
 * daemon startup.
 */
export async function sweepStaleWorktrees(
  rootDir: string = worktreeRoot(),
  audit?: AuditLog,
): Promise<number> {
  let entries: string[];
  try {
    entries = await readdir(rootDir);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const manifestPath = join(rootDir, entry);
    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as WorktreeManifest;
      if (await removeWorktree(manifest.repo, manifest.path)) removed++;
      await rm(manifestPath, { force: true });
    } catch {
      // unreadable manifest — leave it for a human
    }
  }
  if (removed > 0) {
    audit?.append({
      ts: new Date().toISOString(),
      agentId: "daemon",
      a2aTaskId: "-",
      contextId: "-",
      sandbox: "-",
      status: "succeeded",
      durationMs: 0,
      event: "worktree.sweep",
      detail: `removed ${removed} stale worktree(s) from ${rootDir}`,
    });
  }
  return removed;
}
