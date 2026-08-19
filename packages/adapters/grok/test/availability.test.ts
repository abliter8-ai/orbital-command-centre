import { describe, expect, it } from "vitest";
import { isGrokLoggedIn, parseGrokModelCatalog } from "../src/availability.js";

describe("isGrokLoggedIn", () => {
  it("treats a clean version line as authenticated", () => {
    expect(isGrokLoggedIn("grok 1.0.5 (deadbeef) [stable]\n", "")).toBe(true);
  });

  it("does not treat 'not logged in' as authenticated", () => {
    expect(isGrokLoggedIn("You are not logged in. Run `grok login`.\n", "")).toBe(false);
  });
});

describe("parseGrokModelCatalog", () => {
  it("reads default and bullet slugs", () => {
    const catalog = parseGrokModelCatalog(`
You are logged in with grok.com.

Default model: grok-4.6

Available models:
  * grok-4.6 (default)
  - grok-4.5
  - dsv4-think
`);
    expect(catalog.defaultModel).toBe("grok-4.6");
    expect(catalog.models).toEqual(["grok-4.6", "grok-4.5", "dsv4-think"]);
  });
});
