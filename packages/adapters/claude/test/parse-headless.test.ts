import { describe, expect, it } from "vitest";
import { parseClaudeStreamJsonl, streamEventFromClaudeLine } from "../src/parse-headless.js";

const TRANSCRIPT = [
  JSON.stringify({ type: "system", subtype: "init", session_id: "sess-9", cwd: "/tmp" }),
  JSON.stringify({
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        { type: "tool_use", name: "Edit", input: { file_path: "src/a.ts" } },
      ],
    },
  }),
  JSON.stringify({
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", content: "ok" }] },
  }),
  JSON.stringify({
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        { type: "tool_use", name: "Write", input: { file_path: "docs/new.md" } },
      ],
    },
  }),
  JSON.stringify({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text: "Done." }] },
  }),
  JSON.stringify({ type: "rate_limit_event", rate_limit_info: { status: "allowed" } }),
  JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "Done.",
    session_id: "sess-9",
    total_cost_usd: 0.0042,
    usage: { input_tokens: 5, cache_read_input_tokens: 12000, output_tokens: 11 },
  }),
].join("\n");

describe("parseClaudeStreamJsonl", () => {
  it("extracts session, result, usage, cost, and the file-change trail", () => {
    const parsed = parseClaudeStreamJsonl(TRANSCRIPT);
    expect(parsed.sessionId).toBe("sess-9");
    expect(parsed.output).toBe("Done.");
    expect(parsed.isError).toBe(false);
    expect(parsed.costUsd).toBe(0.0042);
    expect(parsed.usage).toEqual({
      inputTokens: 5,
      cachedInputTokens: 12000,
      outputTokens: 11,
    });
    expect(parsed.filesChanged).toEqual([
      { path: "src/a.ts", change: "mod" },
      { path: "docs/new.md", change: "add" },
    ]);
  });

  it("flags an error result", () => {
    const parsed = parseClaudeStreamJsonl(
      JSON.stringify({ type: "result", is_error: true, result: "Credit balance too low" }),
    );
    expect(parsed.isError).toBe(true);
    expect(parsed.output).toBe("Credit balance too low");
  });

  it("treats a transcript with no result event as an error", () => {
    const parsed = parseClaudeStreamJsonl(
      JSON.stringify({ type: "system", subtype: "init", session_id: "s" }),
    );
    expect(parsed.isError).toBe(true);
    expect(parsed.errorMessage).toMatch(/no result event/);
  });
});

describe("streamEventFromClaudeLine", () => {
  it("maps assistant text to a text event", () => {
    expect(
      streamEventFromClaudeLine(
        '{"type":"assistant","message":{"content":[{"type":"text","text":"hello"}]}}',
      ),
    ).toEqual({ kind: "text", text: "hello" });
  });

  it("maps tool_use to tool_start and tool_result to tool_end", () => {
    expect(
      streamEventFromClaudeLine(
        '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{}}]}}',
      ),
    ).toEqual({ kind: "tool_start", text: "Bash" });
    expect(
      streamEventFromClaudeLine(
        '{"type":"user","message":{"content":[{"type":"tool_result","content":"ok"}]}}',
      ),
    ).toEqual({ kind: "tool_end", text: "tool_result" });
  });

  it("returns null for init, rate limits, and junk", () => {
    expect(
      streamEventFromClaudeLine('{"type":"system","subtype":"init","session_id":"s"}'),
    ).toBeNull();
    expect(
      streamEventFromClaudeLine('{"type":"rate_limit_event","rate_limit_info":{}}'),
    ).toBeNull();
    expect(streamEventFromClaudeLine("not json")).toBeNull();
  });
});
