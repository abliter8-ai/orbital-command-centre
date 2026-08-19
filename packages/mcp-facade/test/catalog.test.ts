import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  catalogAgeMs,
  defaultCatalog,
  isCatalogStale,
  loadCatalog,
  saveCatalog,
  type ModelCatalog,
} from "../src/catalog.js";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "occ-catalog-"));
  file = join(dir, "model-catalog.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("model catalog", () => {
  it("falls back to built-in defaults when the file is missing", () => {
    const catalog = loadCatalog(file);
    expect(catalog.updatedAt).toBeNull();
    expect(catalog.agents.codex.models).toContain("gpt-5.6-terra");
    expect(catalog.agents.cursor.defaultModel).toBe("auto");
    expect(catalog.agents.grok.models).toContain("grok-4.6");
    expect(catalog.agents.antigravity.models.length).toBeGreaterThan(0);
    expect(isCatalogStale(catalog)).toBe(true);
  });

  it("falls back to defaults when the file is malformed", () => {
    writeFileSync(file, "{ not json", "utf8");
    const catalog = loadCatalog(file);
    expect(catalog.agents.grok.source).toBe("static");
  });

  it("round-trips a saved catalog and overlays live entries per agent", () => {
    const catalog = defaultCatalog();
    catalog.agents.grok = {
      agentId: "grok",
      fetchedAt: "2026-08-19T15:00:00.000Z",
      cliVersion: "1.0.5",
      defaultModel: "grok-4.6",
      models: ["grok-4.6", "grok-4.5", "dsv4-think", "glm-5-2"],
      source: "live",
    };
    catalog.updatedAt = "2026-08-19T15:00:00.000Z";
    saveCatalog(catalog, file);

    const loaded = loadCatalog(file);
    expect(loaded.agents.grok.models).toContain("dsv4-think");
    expect(loaded.agents.grok.source).toBe("live");
    // Untouched agents keep their defaults.
    expect(loaded.agents.codex.source).toBe("static");
    expect(loaded.updatedAt).toBe("2026-08-19T15:00:00.000Z");
  });

  it("ignores file entries whose agentId does not match the key", () => {
    const bogus: ModelCatalog = defaultCatalog();
    saveCatalog(bogus, file);
    const raw = JSON.parse(JSON.stringify(bogus)) as ModelCatalog;
    raw.agents.grok = { ...raw.agents.grok, agentId: "cursor" };
    writeFileSync(file, JSON.stringify(raw), "utf8");
    const loaded = loadCatalog(file);
    expect(loaded.agents.grok.agentId).toBe("grok");
  });

  it("reports staleness from updatedAt", () => {
    const catalog = defaultCatalog();
    expect(catalogAgeMs(catalog)).toBeNull();
    catalog.updatedAt = new Date().toISOString();
    expect(isCatalogStale(catalog)).toBe(false);
    catalog.updatedAt = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    expect(isCatalogStale(catalog)).toBe(true);
  });
});
