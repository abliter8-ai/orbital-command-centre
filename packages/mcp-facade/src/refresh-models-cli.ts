#!/usr/bin/env node
import { catalogPath, loadCatalog, saveCatalog } from "./catalog.js";
import { probeAllModels } from "./probe-models.js";
import type { AgentId } from "@occ/core";

const path = catalogPath();
const catalog = loadCatalog(path);
const probed = await probeAllModels();

const results: Record<string, { status: string; models: number; source?: string }> = {};
let refreshed = 0;
for (const agentId of ["codex", "cursor", "grok", "antigravity"] as AgentId[]) {
  const entry = probed[agentId];
  if (entry) {
    catalog.agents[agentId] = entry;
    refreshed += 1;
    results[agentId] = { status: "refreshed", models: entry.models.length, source: entry.source };
  } else {
    results[agentId] = {
      status: "kept-previous",
      models: catalog.agents[agentId].models.length,
      source: catalog.agents[agentId].source,
    };
  }
}

if (refreshed > 0) {
  catalog.updatedAt = new Date().toISOString();
  saveCatalog(catalog, path);
}

console.log(JSON.stringify({ path, updatedAt: catalog.updatedAt, refreshed, results }, null, 2));
if (refreshed === 0) {
  console.error("No agent catalog could be probed; previous catalog left untouched.");
  process.exitCode = 1;
}
