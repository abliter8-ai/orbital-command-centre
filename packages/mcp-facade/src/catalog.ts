// Moved to @occ/core (shared by the MCP façade and the control plane).
// This re-export keeps existing imports working.
export {
  CATALOG_MAX_AGE_MS,
  catalogAgeMs,
  catalogPath,
  defaultCatalog,
  isCatalogStale,
  loadCatalog,
  saveCatalog,
  type AgentModelCatalog,
  type ModelCatalog,
} from "@occ/core";
