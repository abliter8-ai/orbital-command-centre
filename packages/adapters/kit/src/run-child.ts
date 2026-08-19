import { spawn } from "node:child_process";
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

export function commandForBin(bin: string, args: string[]): { command: string; args: string[] } {
  if (bin.endsWith(".mjs") || bin.endsWith(".js")) {
    return { command: process.execPath, args: [bin, ...args] };
  }
  return { command: bin, args };
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
      child = spawn(invoked.command, invoked.args, {
        cwd: opts.cwd,
        env: opts.env ?? process.env,
        stdio: [opts.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      });
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
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    const killChild = () => {
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          child.kill("SIGTERM");
        }
      }
    };

    const timer = setTimeout(() => {
      killChild();
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
      killChild();
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
      clearTimeout(timer);
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
