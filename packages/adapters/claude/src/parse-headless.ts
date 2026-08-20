import type { DelegationResult, FileChange, StreamEvent } from "@occ/core";

export interface ParsedClaude {
  sessionId?: string;
  output: string;
  isError: boolean;
  errorMessage?: string;
  filesChanged: FileChange[];
  usage?: DelegationResult["usage"];
  /** What the run cost the account, when the CLI reports it. */
  costUsd?: number;
}

interface ClaudeEvent {
  type?: string;
  subtype?: string;
  session_id?: string;
  is_error?: boolean;
  result?: string;
  total_cost_usd?: number;
  message?: {
    content?: Array<{
      type?: string;
      text?: string;
      name?: string;
      input?: { file_path?: string };
    }>;
  };
  usage?: {
    input_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
    output_tokens?: number;
  };
}

function asEvent(line: string): ClaudeEvent | null {
  try {
    const parsed = JSON.parse(line) as ClaudeEvent;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** Reduce a full claude stream-json transcript to a ParsedClaude. */
export function parseClaudeStreamJsonl(text: string): ParsedClaude {
  const parsed: ParsedClaude = { output: "", isError: false, filesChanged: [] };
  const seenFiles = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;
    const event = asEvent(line);
    if (!event) continue;

    if (event.type === "system" && event.subtype === "init" && event.session_id) {
      parsed.sessionId = event.session_id;
      continue;
    }
    // Best-effort file-change trail from Edit/Write tool calls.
    if (event.type === "assistant" && Array.isArray(event.message?.content)) {
      for (const block of event.message.content) {
        if (block.type !== "tool_use" || !block.name || !block.input?.file_path) continue;
        if (!/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(block.name)) continue;
        const path = block.input.file_path;
        if (seenFiles.has(path)) continue;
        seenFiles.add(path);
        parsed.filesChanged.push({
          path,
          change: block.name === "Write" ? "add" : "mod",
        });
      }
      continue;
    }
    if (event.type === "result") {
      parsed.output = typeof event.result === "string" ? event.result : "";
      parsed.isError = Boolean(event.is_error);
      if (event.session_id) parsed.sessionId = event.session_id;
      if (typeof event.total_cost_usd === "number") parsed.costUsd = event.total_cost_usd;
      if (event.usage) {
        parsed.usage = {
          inputTokens: event.usage.input_tokens,
          cachedInputTokens:
            event.usage.cache_read_input_tokens ?? event.usage.cache_creation_input_tokens,
          outputTokens: event.usage.output_tokens,
        };
      }
    }
  }
  if (parsed.output === "" && !parsed.isError) {
    parsed.isError = true;
    parsed.errorMessage = "Claude produced no result event.";
  }
  return parsed;
}

/**
 * Map one live stream-json line to a StreamEvent. Assistant text blocks are
 * text events; tool_use blocks open a tool event and the matching tool_result
 * (carried in a user message) closes it. System init/hooks and rate-limit
 * notices carry no user-facing progress.
 */
export function streamEventFromClaudeLine(line: string): StreamEvent | null {
  const event = asEvent(line.trim());
  if (!event) return null;

  if (event.type === "assistant" && Array.isArray(event.message?.content)) {
    for (const block of event.message!.content!) {
      if (block.type === "tool_use" && typeof block.name === "string") {
        return { kind: "tool_start", text: block.name };
      }
    }
    const text = event
      .message!.content!.filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text as string)
      .join("");
    return text === "" ? null : { kind: "text", text };
  }

  if (event.type === "user" && Array.isArray(event.message?.content)) {
    if (event.message!.content!.some((block) => block.type === "tool_result")) {
      return { kind: "tool_end", text: "tool_result" };
    }
  }
  return null;
}
