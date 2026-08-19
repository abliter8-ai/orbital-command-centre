import { runChild, type RunChildOutput } from "@occ/adapter-kit";

export type RunExecOutput = RunChildOutput;

export interface RunExecOptions {
  bin: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  lastMessagePath: string;
  signal?: AbortSignal;
}

export async function runCodexExec(opts: RunExecOptions): Promise<RunExecOutput> {
  return runChild(opts);
}

export { commandForBin } from "@occ/adapter-kit";
