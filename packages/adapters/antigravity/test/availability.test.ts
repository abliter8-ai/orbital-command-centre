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
});
