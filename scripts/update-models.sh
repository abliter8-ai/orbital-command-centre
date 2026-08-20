#!/usr/bin/env bash
# Refresh the live model catalog for every installed agent CLI
# (codex config + cursor-agent --list-models + agy models + grok models +
# claude --version; claude aliases stay curated — no non-interactive listing).
# Writes ~/.occ/model-catalog.json (override with OCC_CATALOG_PATH).
# The MCP server reads the catalog at startup — restart Claude Code (or the
# orbital server) to pick up fresh slugs.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="$ROOT/packages/mcp-facade/dist/refresh-models-cli.js"

if [ ! -f "$CLI" ]; then
  echo "dist not built — running pnpm build first" >&2
  (cd "$ROOT" && pnpm build)
fi

node "$CLI"
