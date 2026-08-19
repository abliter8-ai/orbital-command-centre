import { describe, expect, it } from "vitest";
import { parseCursorModelList } from "../src/probe-models.js";

// Shape captured from `cursor-agent --list-models` (2026.08.11-e8db854).
const CURSOR_SAMPLE = `
Available models

auto - Auto (default)
gpt-5.3-codex-low - Codex 5.3 Low
gpt-5.3-codex - Codex 5.3
cursor-grok-4.6-high-fast - Cursor Grok 4.6 Fast
claude-opus-5-thinking-high - Claude Opus 5 1M Thinking
gemini-3.7-flash-high - Gemini 3.7 Flash
`;

describe("parseCursorModelList", () => {
  it("parses slug - label lines and spots the default", () => {
    const { defaultModel, models } = parseCursorModelList(CURSOR_SAMPLE);
    expect(defaultModel).toBe("auto");
    expect(models).toEqual([
      "auto",
      "gpt-5.3-codex-low",
      "gpt-5.3-codex",
      "cursor-grok-4.6-high-fast",
      "claude-opus-5-thinking-high",
      "gemini-3.7-flash-high",
    ]);
  });

  it("returns an empty list for unusable output", () => {
    expect(parseCursorModelList("Error: CURSOR_API_KEY required\n").models).toEqual([]);
    expect(parseCursorModelList("").models).toEqual([]);
  });
});
