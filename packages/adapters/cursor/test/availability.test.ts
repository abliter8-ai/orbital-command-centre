import { describe, expect, it } from "vitest";
import { isCursorLoggedIn } from "../src/availability.js";

describe("isCursorLoggedIn", () => {
  it("treats a checkmark login line as authenticated", () => {
    expect(isCursorLoggedIn("✓ Logged in as test@example.com\n", "")).toBe(true);
  });

  it("does not treat 'Not logged in' as authenticated", () => {
    expect(isCursorLoggedIn("Not logged in\n", "")).toBe(false);
  });

  it("treats authentication required as unauthenticated", () => {
    expect(
      isCursorLoggedIn("", "Error: Authentication required. Please run 'agent login' first."),
    ).toBe(false);
  });
});
