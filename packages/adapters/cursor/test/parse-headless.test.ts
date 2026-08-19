import { describe, expect, it } from "vitest";
import { deriveFileChanges, normalizeHeadlessOutcome, parseJsonResult } from "../src/parse-headless.js";

describe("parseJsonResult / normalizeHeadlessOutcome", () => {
  it("parses a single json result", () => {
    const obj = parseJsonResult(
      '{"type":"result","result":"ok","session_id":"s1","is_error":false}\n',
    );
    expect(obj?.result).toBe("ok");
    expect(obj?.session_id).toBe("s1");
  });

  it("treats is_error as failure", () => {
    const parsed = normalizeHeadlessOutcome({
      stdout: '{"type":"result","is_error":true,"result":"boom","session_id":"s2"}',
      stderr: "",
      exitCode: 0,
      format: "json",
    });
    expect(parsed.isError).toBe(true);
    expect(parsed.errorMessage).toBe("boom");
  });

  it("surfaces stderr when there is no json envelope", () => {
    const parsed = normalizeHeadlessOutcome({
      stdout: "",
      stderr: "Cannot use this model: bogus.",
      exitCode: 1,
      format: "json",
    });
    expect(parsed.isError).toBe(true);
    expect(parsed.errorMessage).toMatch(/Cannot use this model/);
  });

  it("derives file changes from stream-json tool calls", () => {
    const stdout = [
      '{"type":"system","subtype":"init","session_id":"s3"}',
      '{"type":"tool_call","subtype":"completed","tool_call":{"writeToolCall":{"args":{"path":"x.js"}}}}',
      '{"type":"tool_call","subtype":"completed","tool_call":{"readToolCall":{"args":{"path":"ignored.js"}}}}',
      '{"type":"result","subtype":"success","is_error":false,"result":"done","session_id":"s3"}',
    ].join("\n");
    const parsed = normalizeHeadlessOutcome({
      stdout,
      stderr: "",
      exitCode: 0,
      format: "stream-json",
    });
    expect(parsed.output).toBe("done");
    expect(parsed.sessionId).toBe("s3");
    expect(parsed.filesChanged).toEqual([{ path: "x.js", change: "mod" }]);
  });

  it("captures search_replace as a modify", () => {
    expect(
      deriveFileChanges([
        {
          type: "tool_call",
          subtype: "completed",
          tool_call: { searchReplaceToolCall: { args: { path: "edited.js" } } },
        },
      ]),
    ).toEqual([{ path: "edited.js", change: "mod" }]);
  });
});
