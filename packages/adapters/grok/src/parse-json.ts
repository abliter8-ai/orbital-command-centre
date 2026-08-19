import type { DelegationResult } from "@occ/core";

export interface ParsedGrok {
  output: string;
  sessionId?: string;
  stopReason?: string;
  isError: boolean;
  errorMessage?: string;
  usage?: DelegationResult["usage"];
}

interface GrokJson {
  text?: string;
  sessionId?: string;
  stopReason?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export function parseGrokJson(stdout: string, stderr: string, exitCode: number | null): ParsedGrok {
  const trimmed = stdout.trim();
  if (trimmed === "") {
    const message = stderr.trim() || `grok produced no JSON (exit ${exitCode}).`;
    return { output: "", isError: true, errorMessage: message };
  }

  let obj: GrokJson;
  try {
    obj = JSON.parse(trimmed) as GrokJson;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        obj = JSON.parse(trimmed.slice(start, end + 1)) as GrokJson;
      } catch {
        return {
          output: "",
          isError: true,
          errorMessage: stderr.trim() || "Failed to parse grok JSON output.",
        };
      }
    } else {
      return {
        output: "",
        isError: true,
        errorMessage: stderr.trim() || "Failed to parse grok JSON output.",
      };
    }
  }

  const output = typeof obj.text === "string" ? obj.text : "";
  const failedExit = exitCode !== 0 && exitCode !== null;
  const failedStop = Boolean(obj.stopReason && /error|abort|cancel/i.test(obj.stopReason));
  const isError = failedExit || failedStop;
  return {
    output,
    sessionId: obj.sessionId,
    stopReason: obj.stopReason,
    isError,
    errorMessage: isError
      ? stderr.trim() || output || obj.stopReason || `grok exited ${exitCode}`
      : undefined,
    usage: obj.usage
      ? {
          inputTokens: obj.usage.input_tokens,
          cachedInputTokens: obj.usage.cache_read_input_tokens,
          outputTokens: obj.usage.output_tokens,
        }
      : undefined,
  };
}
