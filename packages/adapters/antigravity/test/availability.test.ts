import { describe, expect, it } from "vitest";
import { isAgyLoggedIn, parseAgyModelCatalog } from "../src/availability.js";

describe("isAgyLoggedIn", () => {
  it("treats a clean version line as authenticated", () => {
    expect(isAgyLoggedIn("1.1.15\n", "")).toBe(true);
  });

  it("treats authentication required as unauthenticated", () => {
    expect(isAgyLoggedIn("", "authentication required\n")).toBe(false);
  });
});

describe("parseAgyModelCatalog", () => {
  it("reads slugs from agy models output", () => {
    const models = parseAgyModelCatalog(`
Fetching available models...
gemini-3.7-flash-highGemini 3.7 Flash (High)
gemini-3.5-flash-mediumGemini 3.5 Flash (Medium)
claude-sonnet-4-6Claude Sonnet 4.6 (Thinking)
`);
    expect(models).toEqual([
      "gemini-3.7-flash-high",
      "gemini-3.5-flash-medium",
      "claude-sonnet-4-6",
    ]);
  });

  it("reads slugs from live tab-separated agy models output", () => {
    // Captured from `agy models` 1.1.15 on ruin-max.
    const models = parseAgyModelCatalog(`
Fetching available models...
gemini-3.7-flash-high\tGemini 3.7 Flash (High)
gemini-3.1-pro-low\tGemini 3.1 Pro (Low)
claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)
gpt-oss-120b-medium\tGPT-OSS 120B (Medium)
`);
    expect(models).toEqual([
      "gemini-3.7-flash-high",
      "gemini-3.1-pro-low",
      "claude-sonnet-4-6",
      "gpt-oss-120b-medium",
    ]);
  });
});
