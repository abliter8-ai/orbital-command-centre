import { runChild, type RunChildOutput } from "@occ/adapter-kit";

export type RunExecOutput = RunChildOutput;

export interface RunExecOptions {
  bin: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  lastMessagePath: string;
  signal?: AbortSignal;
  /** Live stdout chunks, for streaming JSONL event parsing. */
  onStdoutData?: (chunk: string) => void;
}

export async function runCodexExec(opts: RunExecOptions): Promise<RunExecOutput> {
  return runChild(opts);
}

export { commandForBin } from "@occ/adapter-kit";
