import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  RESEARCH_ALLOW_RULES,
  applyResearchAllowRules,
  buildResearchBrief,
  checkResearchPermissions,
} from "../src/native.js";

describe("checkResearchPermissions", () => {
  let dir: string;
  let settingsPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "occ-agy-settings-"));
    settingsPath = join(dir, "settings.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reports all rules missing when the file does not exist", async () => {
    const pre = await checkResearchPermissions(settingsPath);
    expect(pre.readable).toBe(false);
    expect(pre.missing).toEqual([...RESEARCH_ALLOW_RULES]);
    expect(pre.present).toEqual([]);
  });

  it("reports present rules and preserves the existing allow list", async () => {
    await writeFile(
      settingsPath,
      JSON.stringify({ permissions: { allow: ["read_url(*)", "command(git status)"] } }),
    );
    const pre = await checkResearchPermissions(settingsPath);
    expect(pre.readable).toBe(true);
    expect(pre.missing).toEqual([]);
    expect(pre.present).toEqual(["read_url(*)"]);
    expect(pre.allowRules).toContain("command(git status)");
  });

  it("treats invalid JSON as unreadable, not as a crash", async () => {
    await writeFile(settingsPath, "{ not json");
    const pre = await checkResearchPermissions(settingsPath);
    expect(pre.readable).toBe(false);
    expect(pre.missing).toEqual([...RESEARCH_ALLOW_RULES]);
  });
});

describe("applyResearchAllowRules", () => {
  let dir: string;
  let settingsPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "occ-agy-settings-"));
    settingsPath = join(dir, "settings.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("creates the settings file when absent", async () => {
    const result = await applyResearchAllowRules(settingsPath);
    expect(result.added).toEqual([...RESEARCH_ALLOW_RULES]);
    expect(result.backupPath).toBeUndefined();
    const written = JSON.parse(await readFile(settingsPath, "utf8")) as {
      permissions: { allow: string[] };
    };
    expect(written.permissions.allow).toEqual(["read_url(*)"]);
  });

  it("merges without clobbering and writes a backup", async () => {
    await writeFile(
      settingsPath,
      JSON.stringify({ permissions: { allow: ["command(git status)"], deny: ["execute_url(*)"] } }),
    );
    const result = await applyResearchAllowRules(settingsPath);
    expect(result.added).toEqual(["read_url(*)"]);
    expect(result.backupPath).toBeDefined();
    const written = JSON.parse(await readFile(settingsPath, "utf8")) as {
      permissions: { allow: string[]; deny: string[] };
    };
    expect(written.permissions.allow).toEqual(["command(git status)", "read_url(*)"]);
    expect(written.permissions.deny).toEqual(["execute_url(*)"]);
    const backup = JSON.parse(await readFile(result.backupPath!, "utf8")) as {
      permissions: { allow: string[] };
    };
    expect(backup.permissions.allow).toEqual(["command(git status)"]);
  });

  it("is a no-op when rules already exist", async () => {
    await writeFile(settingsPath, JSON.stringify({ permissions: { allow: ["read_url(*)"] } }));
    const result = await applyResearchAllowRules(settingsPath);
    expect(result.added).toEqual([]);
    expect(result.backupPath).toBeUndefined();
  });

  it("preserves a malformed settings file in a backup before replacing it", async () => {
    const malformed = '{ "permissions": { "allow": ["command(git status)"], ';
    await writeFile(settingsPath, malformed);
    const result = await applyResearchAllowRules(settingsPath);
    expect(result.added).toEqual(["read_url(*)"]);
    // The original bytes survive in the backup…
    expect(result.backupPath).toBeDefined();
    expect(await readFile(result.backupPath!, "utf8")).toBe(malformed);
    // …and the live file is now valid JSON with the rule.
    const written = JSON.parse(await readFile(settingsPath, "utf8")) as {
      permissions: { allow: string[] };
    };
    expect(written.permissions.allow).toEqual(["read_url(*)"]);
  });
});

describe("buildResearchBrief", () => {
  it("includes the question, web-tool instruction, and report format", () => {
    const brief = buildResearchBrief({ question: "What shipped in Node 24?" });
    expect(brief).toContain("What shipped in Node 24?");
    expect(brief).toContain("google_search");
    expect(brief).toContain("read_url");
    expect(brief).toContain("Sources");
    expect(brief).toContain("Do not edit files");
    expect(brief).not.toContain("subagents to research");
  });

  it("adds fetch pages and subagent instruction when requested", () => {
    const brief = buildResearchBrief({
      question: "Compare X and Y",
      fetchPages: ["https://example.com/x", "https://example.com/y"],
      subagents: true,
    });
    expect(brief).toContain("https://example.com/x");
    expect(brief).toContain("https://example.com/y");
    expect(brief).toContain("Spawn subagents");
  });
});
