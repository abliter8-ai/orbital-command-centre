import type { FileChange, StreamEvent } from "@occ/core";

export interface CursorResultObject {
  type?: string;
  result?: string;
  session_id?: string;
  is_error?: boolean;
}

export interface ParsedCursor {
  sessionId?: string;
  output: string;
  filesChanged: FileChange[];
  isError: boolean;
  errorMessage?: string;
}

const EDIT_TOOL_PATTERN = /(write|edit|create|delete|move|rename|patch|replace)/i;

export function parseJsonResult(text: string): CursorResultObject | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  try {
    const obj = JSON.parse(trimmed) as CursorResultObject;
    if (obj && typeof obj === "object") return obj;
  } catch {
    // scan lines
  }
  for (const line of trimmed.split(/\r?\n/).reverse()) {
    const candidate = line.trim();
    if (!candidate.startsWith("{")) continue;
    try {
      const obj = JSON.parse(candidate) as CursorResultObject;
      if (obj.type === "result") return obj;
    } catch {
      // keep scanning
    }
  }
  return null;
}

export function parseStreamJsonl(text: string): unknown[] {
  const events: unknown[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // ignore junk
    }
  }
  return events;
}

/**
 * Map one live cursor-agent stream-json line to a StreamEvent. Assistant
 * messages arrive whole (no token deltas); tool calls arrive as
 * started/completed pairs. Returns null for bookkeeping lines.
 */
export function streamEventFromCursorLine(line: string): StreamEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  const rec = asRecord(parsed);
  if (!rec) return null;

  if (rec.type === "assistant") {
    const message = asRecord(rec.message);
    const content = Array.isArray(message?.content) ? message.content : [];
    const text = content
      .map((block) => asRecord(block))
      .filter((block) => block?.type === "text" && typeof block.text === "string")
      .map((block) => block!.text as string)
      .join("");
    return text === "" ? null : { kind: "text", text };
  }

  if (rec.type === "tool_call") {
    const toolCall = asRecord(rec.tool_call);
    const name = toolCall ? (Object.keys(toolCall)[0] ?? "tool") : "tool";
    if (rec.subtype === "started") return { kind: "tool_start", text: name };
    if (rec.subtype === "completed") return { kind: "tool_end", text: name };
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

export function deriveFileChanges(events: unknown[]): FileChange[] {
  const out: FileChange[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    const rec = asRecord(event);
    if (rec?.type !== "tool_call" || rec.subtype !== "completed") continue;
    const toolCall = asRecord(rec.tool_call);
    if (!toolCall) continue;
    const key = Object.keys(toolCall)[0] ?? "";
    if (!EDIT_TOOL_PATTERN.test(key)) continue;
    const inner = asRecord(toolCall[key]);
    const args = asRecord(inner?.args);
    const result = asRecord(inner?.result);
    const success = asRecord(result?.success);
    const path =
      (typeof args?.path === "string" && args.path) ||
      (typeof success?.path === "string" && success.path) ||
      null;
    if (!path || seen.has(path)) continue;
    seen.add(path);
    const change: FileChange["change"] = /delete/i.test(key)
      ? "del"
      : /create/i.test(key)
        ? "add"
        : "mod";
    out.push({ path, change });
  }
  return out;
}

function firstSessionId(events: unknown[]): string | undefined {
  for (const event of events) {
    const rec = asRecord(event);
    if (typeof rec?.session_id === "string") return rec.session_id;
  }
  return undefined;
}

export function normalizeHeadlessOutcome(input: {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  format: "json" | "stream-json";
}): ParsedCursor {
  const events = input.format === "stream-json" ? parseStreamJsonl(input.stdout) : [];
  const resultObj =
    input.format === "stream-json"
      ? ([...events].reverse().find((event) => asRecord(event)?.type === "result") as
          | CursorResultObject
          | undefined) ?? null
      : parseJsonResult(input.stdout);

  const filesChanged = deriveFileChanges(events);

  if (!resultObj) {
    const message =
      input.stderr.trim() ||
      input.stdout.trim() ||
      `Cursor produced no result (exit ${input.exitCode}).`;
    return {
      sessionId: firstSessionId(events),
      output: "",
      filesChanged,
      isError: true,
      errorMessage: message,
    };
  }

  const output = typeof resultObj.result === "string" ? resultObj.result : "";
  const isError = Boolean(resultObj.is_error) || input.exitCode !== 0;
  return {
    sessionId: resultObj.session_id ?? firstSessionId(events),
    output,
    filesChanged,
    isError,
    errorMessage: isError
      ? output || input.stderr.trim() || "Cursor reported an error."
      : undefined,
  };
}
