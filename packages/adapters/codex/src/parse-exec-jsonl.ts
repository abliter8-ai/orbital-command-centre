import type { DelegationResult, FileChange } from "@occ/core";

export interface ParsedExec {
  threadId?: string;
  output: string;
  filesChanged: FileChange[];
  usage?: DelegationResult["usage"];
  turnFailed?: string;
  fatalError?: string;
}

interface ExecEvent {
  type?: string;
  thread_id?: string;
  message?: string;
  error?: { message?: string };
  usage?: {
    input_tokens?: number;
    cached_input_tokens?: number;
    output_tokens?: number;
  };
  item?: {
    type?: string;
    text?: string;
    changes?: Array<{ path?: string; kind?: string }>;
  };
}

function mapChangeKind(kind: string | undefined): FileChange["change"] {
  if (kind === "add") return "add";
  if (kind === "update") return "mod";
  if (kind === "delete") return "del";
  return "unknown";
}

export function parseExecJsonl(text: string): ParsedExec {
  const parsed: ParsedExec = {
    output: "",
    filesChanged: [],
  };

  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") continue;

    let event: ExecEvent;
    try {
      event = JSON.parse(line) as ExecEvent;
    } catch {
      continue;
    }

    if (event.type === "thread.started" && typeof event.thread_id === "string") {
      parsed.threadId = event.thread_id;
      continue;
    }

    if (event.type === "turn.completed" && event.usage) {
      parsed.usage = {
        inputTokens: event.usage.input_tokens,
        cachedInputTokens: event.usage.cached_input_tokens,
        outputTokens: event.usage.output_tokens,
      };
      continue;
    }

    if (event.type === "turn.failed") {
      parsed.turnFailed = event.error?.message ?? "turn failed";
      continue;
    }

    if (event.type === "error") {
      const message = event.message ?? "stream error";
      if (/^Reconnecting\.\.\./.test(message)) {
        continue;
      }
      parsed.fatalError = message;
      continue;
    }

    if (event.type === "item.completed" && event.item) {
      if (event.item.type === "agent_message" && typeof event.item.text === "string") {
        parsed.output = event.item.text;
      }
      if (event.item.type === "file_change" && Array.isArray(event.item.changes)) {
        for (const change of event.item.changes) {
          if (!change.path) continue;
          parsed.filesChanged.push({
            path: change.path,
            change: mapChangeKind(change.kind),
          });
        }
      }
    }
  }

  return parsed;
}

export function summariseOutput(output: string, maxChars = 1500): string {
  if (output.length <= maxChars) return output;
  return `${output.slice(0, maxChars).trimEnd()}…`;
}
