import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { readFile } from "node:fs/promises";

export interface RunChildOptions {
  bin: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  stdin?: string;
  env?: NodeJS.ProcessEnv;
  lastMessagePath?: string;
  signal?: AbortSignal;
  /** Grace period after SIGTERM before SIGKILL. Default 4000. */
  killGraceMs?: number;
  /** Called with each stdout chunk as it arrives (for live event parsing). */
  onStdoutData?: (chunk: string) => void;
}

export interface RunChildOutput {
  code: number | null;
  stdout: string;
  stderr: string;
  lastMessage: string;
  timedOut: boolean;
  cancelled: boolean;
  spawnError?: string;
}

export const DEFAULT_KILL_GRACE_MS = 4_000;

/**
 * Adapt arbitrary stdout chunks into whole lines. Buffers partial lines; call
 * flush() at process end to emit any trailing unterminated line.
 */
export function lineSplitter(onLine: (line: string) => void): {
  push: (chunk: string) => void;
  flush: () => void;
} {
  let buffer = "";
  return {
    push(chunk: string) {
      buffer += chunk;
      let idx = buffer.indexOf("\n");
      while (idx >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line !== "") onLine(line);
        idx = buffer.indexOf("\n");
      }
    },
    flush() {
      const line = buffer.trim();
      buffer = "";
      if (line !== "") onLine(line);
    },
  };
}

export function commandForBin(bin: string, args: string[]): { command: string; args: string[] } {
  if (bin.endsWith(".mjs") || bin.endsWith(".js")) {
    return { command: process.execPath, args: [bin, ...args] };
  }
  return { command: bin, args };
}

/**
 * Pure spawn-option builder, exported for tests. POSIX spawns are detached so
 * the child leads its own process group — that is what makes the group kill in
 * killTree actually reach grandchildren (agent-spawned servers, test runners).
 */
export function buildSpawnOptions(opts: RunChildOptions): SpawnOptions {
  return {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    stdio: [opts.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
  };
}

/**
 * Kill the child and everything it spawned. POSIX: signal the process group
 * (requires the detached spawn from buildSpawnOptions), falling back to the
 * direct child if the group is gone. Windows: taskkill /T walks the tree.
 */
export function killTree(child: ChildProcess, signal: NodeJS.Signals = "SIGTERM"): void {
  if (!child.pid) return;
  if (process.platform === "win32") {
    try {
      const tk = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
      tk.on("error", () => {});
      tk.unref();
    } catch {
      child.kill(signal);
    }
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // already gone
    }
  }
}

export async function runChild(opts: RunChildOptions): Promise<RunChildOutput> {
  return await new Promise((resolve) => {
    let settled = false;
    const finish = async (output: Omit<RunChildOutput, "lastMessage">) => {
      if (settled) return;
      settled = true;
      let lastMessage = "";
      if (opts.lastMessagePath) {
        try {
          lastMessage = (await readFile(opts.lastMessagePath, "utf8")).trim();
        } catch {
          lastMessage = "";
        }
      }
      resolve({ ...output, lastMessage });
    };

    let child;
    try {
      const invoked = commandForBin(opts.bin, opts.args);
      child = spawn(invoked.command, invoked.args, buildSpawnOptions(opts));
    } catch (error) {
      void finish({
        code: null,
        stdout: "",
        stderr: "",
        timedOut: false,
        cancelled: false,
        spawnError: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    if (opts.stdin !== undefined && child.stdin) {
      child.stdin.end(opts.stdin);
    }

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout += text;
      opts.onStdoutData?.(text);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    let closed = false;
    let escalate: NodeJS.Timeout | undefined;
    const killAndEscalate = () => {
      if (closed) return;
      killTree(child, "SIGTERM");
      escalate = setTimeout(() => {
        if (!closed) killTree(child, "SIGKILL");
      }, opts.killGraceMs ?? DEFAULT_KILL_GRACE_MS);
      escalate.unref?.();
    };

    const timer = setTimeout(() => {
      killAndEscalate();
      void finish({
        code: null,
        stdout,
        stderr,
        timedOut: true,
        cancelled: false,
      });
    }, opts.timeoutMs);

    const onAbort = () => {
      clearTimeout(timer);
      killAndEscalate();
      void finish({
        code: null,
        stdout,
        stderr,
        timedOut: false,
        cancelled: true,
      });
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    child.on("error", (error) => {
      clearTimeout(timer);
      if (escalate) clearTimeout(escalate);
      opts.signal?.removeEventListener("abort", onAbort);
      void finish({
        code: null,
        stdout,
        stderr,
        timedOut: false,
        cancelled: false,
        spawnError: error.message,
      });
    });

    child.on("close", (code) => {
      closed = true;
      clearTimeout(timer);
      if (escalate) clearTimeout(escalate);
      opts.signal?.removeEventListener("abort", onAbort);
      void finish({
        code,
        stdout,
        stderr,
        timedOut: false,
        cancelled: false,
      });
    });
  });
}
