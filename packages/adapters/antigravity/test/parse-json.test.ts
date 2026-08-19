import { describe, expect, it } from "vitest";
import { parseAgyJson } from "../src/parse-json.js";

const success = {
  conversation_id: "agy-sess-1",
  status: "SUCCESS",
  response: "PING",
  usage: { input_tokens: 12, output_tokens: 1, cache_read_tokens: 3 },
};

describe("parseAgyJson", () => {
  it("maps a clean json envelope", () => {
    const parsed = parseAgyJson(JSON.stringify(success), "", 0);
    expect(parsed.isError).toBe(false);
    expect(parsed.output).toBe("PING");
    expect(parsed.sessionId).toBe("agy-sess-1");
    expect(parsed.usage).toEqual({
      inputTokens: 12,
      cachedInputTokens: 3,
      outputTokens: 1,
    });
  });

  it("flags ERROR status and unknown model", () => {
    const parsed = parseAgyJson(
      JSON.stringify({ conversation_id: "", status: "ERROR", error: "unknown model" }),
      "",
      1,
    );
    expect(parsed.isError).toBe(true);
    expect(parsed.errorMessage).toMatch(/unknown model/);
  });

  it("detects soft-deny on stderr even when status is SUCCESS", () => {
    const parsed = parseAgyJson(
      JSON.stringify(success),
      "Tool command(npm) would have asked. Allow this tool in settings.",
      0,
    );
    expect(parsed.isError).toBe(false);
    expect(parsed.softDenied).toBe(true);
  });
});
