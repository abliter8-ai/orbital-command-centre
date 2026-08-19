import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isCatalogStale, type ModelCatalog } from "./catalog.js";

/**
 * Fire-and-forget catalog refresh: spawns the standalone refresher so the
 * server never runs `* models` probes in its own process tree (Grok 1.0.5
 * poisons a following `grok -p` if probed in-process). The running server
 * keeps the catalog it loaded at startup; the next restart picks up the
 * refresh. Set OCC_CATALOG_REFRESH=off to disable.
 */
export function refreshCatalogIfStale(catalog: ModelCatalog): boolean {
  if (process.env.OCC_CATALOG_REFRESH === "off") return false;
  if (!isCatalogStale(catalog)) return false;
  try {
    const cli = fileURLToPath(new URL("./refresh-models-cli.js", import.meta.url));
    const child = spawn(process.execPath, [cli], { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}
