import { describe, expect, it } from "vitest";
import { FakeAgentHandle } from "../src/fake-handle.js";
import { AgentRegistry, UnknownAgentError } from "../src/registry.js";

describe("AgentRegistry", () => {
  it("registers a handle and returns it by id", () => {
    const registry = new AgentRegistry();
    const handle = new FakeAgentHandle();
    registry.register(handle);
    expect(registry.get("codex")).toBe(handle);
    expect(registry.list()).toEqual([handle]);
  });

  it("throws with known ids when the agent is missing", () => {
    const empty = new AgentRegistry();
    expect(() => empty.get("codex")).toThrow(UnknownAgentError);
    expect(() => empty.get("codex")).toThrow(/none registered/);

    const registry = new AgentRegistry();
    registry.register(new FakeAgentHandle());
    const unknown = "nope" as unknown as "codex";
    expect(() => registry.get(unknown)).toThrow(/Known ids: codex/);
  });
});
