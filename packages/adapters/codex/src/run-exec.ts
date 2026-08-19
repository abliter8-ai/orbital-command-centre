import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

export interface RunExecOptions {
  bin: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  lastMessagePath: string;
  signal?: AbortSignal;
}

export interface RunExecOutput {
  code: number | null;
  stdout: string;
  stderr: string;
  lastMessage: string;
  timedOut: boolean;
  cancelled: boolean;
  spawnError?: string;
}

export async function runCodexExec(opts: RunExecOptions): Promise<RunExecOutput> {
  return await new Promise((resolve) => {
    let settled = false;
    const finish = async (output: Omit<RunExecOutput, "lastMessage">) => {
      if (settled) return;
      settled = true;
      let lastMessage = "";
      try {
        lastMessage = (await readFile(opts.lastMessagePath, "utf8")).trim();
      } catch {
        lastMessage = "";
      }
      resolve({ ...output, lastMessage });
    };

    let child;
    try {
      const { command, args } = commandForBin(opts.bin, opts.args);
      child = spawn(command, args, {
        cwd: opts.cwd,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
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

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
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

export function commandForBin(bin: string, args: string[]): { command: string; args: string[] } {
  if (bin.endsWith(".mjs") || bin.endsWith(".js")) {
    return { command: process.execPath, args: [bin, ...args] };
  }
  return { command: bin, args };
}
