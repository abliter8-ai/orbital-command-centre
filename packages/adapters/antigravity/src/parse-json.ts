import type { DelegationResult } from "@occ/core";

export interface ParsedAgy {
  output: string;
  sessionId?: string;
  status?: string;
  isError: boolean;
  errorMessage?: string;
  usage?: DelegationResult["usage"];
  softDenied: boolean;
}

interface AgyJson {
  conversation_id?: string;
  status?: string;
  response?: string;
  error?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_tokens?: number;
  };
}

const SOFT_DENY = /soft-den|permission denied|not allowed|would have asked|allow this tool/i;

export function parseAgyJson(stdout: string, stderr: string, exitCode: number | null): ParsedAgy {
  const softDenied = SOFT_DENY.test(stderr);
  const trimmed = stdout.trim();
  if (trimmed === "") {
    const message = stderr.trim() || `agy produced no JSON (exit ${exitCode}).`;
    return { output: "", isError: true, errorMessage: message, softDenied };
  }

  let obj: AgyJson;
  try {
    obj = JSON.parse(trimmed) as AgyJson;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        obj = JSON.parse(trimmed.slice(start, end + 1)) as AgyJson;
      } catch {
        return {
          output: "",
          isError: true,
          errorMessage: stderr.trim() || "Failed to parse agy JSON output.",
          softDenied,
        };
      }
    } else {
      return {
        output: "",
        isError: true,
        errorMessage: stderr.trim() || "Failed to parse agy JSON output.",
        softDenied,
      };
    }
  }

  const output = typeof obj.response === "string" ? obj.response : "";
  const failedExit = exitCode !== 0 && exitCode !== null;
  const failedStatus = Boolean(obj.status && obj.status !== "SUCCESS" && obj.status !== "RUNNING");
  const isError = failedExit || failedStatus || Boolean(obj.error);
  return {
    output,
    sessionId: obj.conversation_id || undefined,
    status: obj.status,
    isError,
    errorMessage: isError
      ? obj.error || stderr.trim() || output || obj.status || `agy exited ${exitCode}`
      : undefined,
    usage: obj.usage
      ? {
          inputTokens: obj.usage.input_tokens,
          cachedInputTokens: obj.usage.cache_read_tokens,
          outputTokens: obj.usage.output_tokens,
        }
      : undefined,
    softDenied,
  };
}
