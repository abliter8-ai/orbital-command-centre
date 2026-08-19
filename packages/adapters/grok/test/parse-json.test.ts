import { describe, expect, it } from "vitest";
import { parseGrokJson } from "../src/parse-json.js";

const success = {
  text: "PING",
  sessionId: "grok-sess-1",
  stopReason: "end_turn",
  usage: { input_tokens: 12, output_tokens: 1, cache_read_input_tokens: 3 },
};

describe("parseGrokJson", () => {
  it("maps a clean json object", () => {
    const parsed = parseGrokJson(JSON.stringify(success), "", 0);
    expect(parsed.isError).toBe(false);
    expect(parsed.output).toBe("PING");
    expect(parsed.sessionId).toBe("grok-sess-1");
    expect(parsed.stopReason).toBe("end_turn");
    expect(parsed.usage).toEqual({
      inputTokens: 12,
      cachedInputTokens: 3,
      outputTokens: 1,
    });
  });

  it("extracts json from noisy stdout", () => {
    const parsed = parseGrokJson(`note\n${JSON.stringify(success)}\n`, "", 0);
    expect(parsed.output).toBe("PING");
    expect(parsed.sessionId).toBe("grok-sess-1");
  });

  it("fails on empty stdout", () => {
    const parsed = parseGrokJson("", "device not configured", 1);
    expect(parsed.isError).toBe(true);
    expect(parsed.errorMessage).toMatch(/device not configured/);
  });

  it("treats error stopReason as failure", () => {
    const parsed = parseGrokJson(
      JSON.stringify({ text: "nope", sessionId: "x", stopReason: "error" }),
      "",
      0,
    );
    expect(parsed.isError).toBe(true);
    expect(parsed.errorMessage).toMatch(/nope|error/);
  });
});
