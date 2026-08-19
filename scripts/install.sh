#!/usr/bin/env bash
# Orbital Command Centre — installer (macOS / Linux)
#
# What it does:
#   1. Checks Node >= 22 and pnpm 10 (tries corepack if pnpm is missing)
#   2. pnpm install / build / test
#   3. Checks the underlying coding CLIs (codex, cursor-agent, grok, agy) are
#      present and meets OCC's tested minimum versions; --upgrade-clis runs
#      each CLI's own `update` subcommand when it is behind
#   4. Registers the orbital MCP server with Claude Code (absolute path)
#   5. Grants the orbital MCP tools in ~/.claude/settings.json (backup first)
#   6. Links the delegating-to-* and choosing-the-right-agent skills into ~/.claude/skills
#   7. Appends a short "delegate to save tokens" pointer to ~/.claude/CLAUDE.md
#   8. Refreshes the live model catalog (~/.occ/model-catalog.json)
#
# Usage:
#   scripts/install.sh [--skip-tests] [--upgrade-clis] [--no-mcp] [--no-skills] [--no-claude-md]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS_TARGET="${HOME}/.claude/skills"
CLAUDE_SETTINGS="${HOME}/.claude/settings.json"
CLAUDE_MD="${HOME}/.claude/CLAUDE.md"
SKIP_TESTS=0
UPGRADE_CLIS=0
DO_MCP=1
DO_SKILLS=1
DO_CLAUDE_MD=1

for arg in "$@"; do
  case "$arg" in
    --skip-tests) SKIP_TESTS=1 ;;
    --upgrade-clis) UPGRADE_CLIS=1 ;;
    --no-mcp) DO_MCP=0 ;;
    --no-skills) DO_SKILLS=0 ;;
    --no-claude-md) DO_CLAUDE_MD=0 ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "Unknown flag: $arg" >&2; exit 2 ;;
  esac
done

say()  { printf '\033[1m== %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '  \033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# version_ge A B — true if dotted-version A >= B (uses node; already required)
version_ge() {
  node -e '
    const [a, b] = process.argv.slice(1);
    const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
    const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d !== 0) process.exit(d > 0 ? 0 : 1);
    }
    process.exit(0);
  ' "$1" "$2"
}

say "1/8 Toolchain"
command -v node >/dev/null 2>&1 || die "node not found. Install Node >= 22 (https://nodejs.org or nvm)."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 22 ] || die "node $(node -v) is too old — need >= 22."
ok "node $(node -v)"

if ! command -v pnpm >/dev/null 2>&1; then
  warn "pnpm not found — trying corepack"
  corepack enable >/dev/null 2>&1 || die "corepack unavailable. Install pnpm 10: npm i -g pnpm@10"
  corepack prepare pnpm@10 --activate >/dev/null 2>&1 || die "could not activate pnpm 10"
fi
PNPM_MAJOR="$(pnpm -v | cut -d. -f1)"
[ "$PNPM_MAJOR" -ge 10 ] || die "pnpm $(pnpm -v) is too old — need >= 10 (corepack prepare pnpm@10 --activate)."
ok "pnpm $(pnpm -v)"

say "2/8 Build"
cd "$ROOT"
pnpm install --frozen-lockfile
pnpm build
if [ "$SKIP_TESTS" -eq 0 ]; then
  pnpm test
  ok "tests passed"
else
  warn "tests skipped (--skip-tests)"
fi

say "3/8 Coding CLIs"
# name|binary|minimum tested version|install hint
CLIS=(
  "codex|codex|0.148.0|npm i -g @openai/codex  (then: codex login)"
  "cursor|cursor-agent|2026.08.11|curl https://cursor.com/install -fsS | bash  (then: cursor-agent login)"
  "grok|grok|1.0.5|see https://grok.com/cli  (then: grok login)"
  "antigravity|agy|1.1.15|see https://antigravity.google  (then: run agy once to cache OAuth)"
)
ANY_CLI=0
for entry in "${CLIS[@]}"; do
  IFS='|' read -r name bin minimum hint <<<"$entry"
  if ! command -v "$bin" >/dev/null 2>&1; then
    warn "$name: '$bin' not on PATH — $hint"
    continue
  fi
  raw="$("$bin" --version 2>/dev/null | head -n1 || true)"
  version="$(printf '%s' "$raw" | grep -oE '[0-9]+(\.[0-9]+)+(-[0-9a-f]+)?' | head -n1)"
  if [ -z "$version" ]; then
    warn "$name: could not parse version from '$raw'"
    continue
  fi
  if version_ge "$version" "$minimum"; then
    ok "$name $version (>= $minimum tested)"
  else
    warn "$name $version is older than the tested $minimum"
    if [ "$UPGRADE_CLIS" -eq 1 ]; then
      say "    upgrading $name via '$bin update'"
      "$bin" update || warn "$name self-update failed — update it manually"
    else
      warn "    re-run with --upgrade-clis, or: $bin update"
    fi
  fi
  ANY_CLI=1
done
[ "$ANY_CLI" -eq 1 ] || warn "no coding CLIs found — install at least one before delegating"

say "4/8 MCP registration (Claude Code)"
if [ "$DO_MCP" -eq 0 ]; then
  warn "skipped (--no-mcp)"
elif command -v claude >/dev/null 2>&1; then
  if claude mcp get orbital >/dev/null 2>&1; then
    claude mcp remove orbital >/dev/null 2>&1 || true
  fi
  claude mcp add orbital -- node "$ROOT/packages/mcp-facade/dist/stdio.js"
  ok "claude mcp add orbital -- node $ROOT/packages/mcp-facade/dist/stdio.js"
else
  warn "'claude' CLI not found — register manually later:"
  warn "  claude mcp add orbital -- node \"$ROOT/packages/mcp-facade/dist/stdio.js\""
fi

say "5/8 Tool permissions"
mkdir -p "$(dirname "$CLAUDE_SETTINGS")"
if [ -f "$CLAUDE_SETTINGS" ]; then
  cp "$CLAUDE_SETTINGS" "$CLAUDE_SETTINGS.bak-$(date +%Y%m%d%H%M%S)"
fi
node - "$CLAUDE_SETTINGS" <<'EOF'
const fs = require("node:fs");
const path = require("node:path");
const file = process.argv[2];
const tools = [
  "mcp__orbital__occ_health",
  "mcp__orbital__occ_models",
  "mcp__orbital__occ_tasks",
  "mcp__orbital__occ_cancel",
  "mcp__orbital__occ_capabilities",
  "mcp__orbital__delegate_to_codex",
  "mcp__orbital__delegate_to_cursor",
  "mcp__orbital__delegate_to_grok",
  "mcp__orbital__delegate_to_antigravity",
  "mcp__orbital__grok_x_search",
  "mcp__orbital__grok_imagine",
  "mcp__orbital__grok_video",
];
let settings = {};
try { settings = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
settings.permissions = settings.permissions ?? {};
const allow = new Set([...(settings.permissions.allow ?? []), ...tools]);
settings.permissions.allow = [...allow].sort();
fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
console.log(`  merged ${tools.length} orbital permissions into ${file}`);
EOF
ok "permissions.allow updated (backup written if a file existed)"

say "6/8 Skills"
if [ "$DO_SKILLS" -eq 0 ]; then
  warn "skipped (--no-skills)"
else
  mkdir -p "$SKILLS_TARGET"
  for skill in "$ROOT"/skills/delegating-to-* "$ROOT"/skills/choosing-the-right-agent; do
    [ -d "$skill" ] || continue
    name="$(basename "$skill")"
    if ln -sfn "$skill" "$SKILLS_TARGET/$name" 2>/dev/null; then
      ok "linked $name -> $SKILLS_TARGET/$name"
    else
      rm -rf "$SKILLS_TARGET/$name"
      cp -R "$skill" "$SKILLS_TARGET/$name"
      ok "copied $name -> $SKILLS_TARGET/$name"
    fi
  done
fi

say "7/8 CLAUDE.md note"
if [ "$DO_CLAUDE_MD" -eq 0 ]; then
  warn "skipped (--no-claude-md)"
elif [ -f "$CLAUDE_MD" ] && grep -qF '<!-- orbital-occ -->' "$CLAUDE_MD"; then
  ok "CLAUDE.md already has the orbital note"
else
  mkdir -p "$(dirname "$CLAUDE_MD")"
  cat >> "$CLAUDE_MD" <<'EOF'

<!-- orbital-occ -->
## Orbital OCC delegation
Save context tokens: delegate implementation, investigation, and research to the orbital MCP tools `delegate_to_codex` / `delegate_to_cursor` / `delegate_to_grok` / `delegate_to_antigravity` instead of doing it in-context (check `occ_health` first; `occ_capabilities` shows who owns what, `occ_models` the live model lists).
Grok also does what this harness cannot: `grok_x_search` (live X posts), `grok_imagine` (image gen/edit), `grok_video` (short video from a still).
EOF
  ok "appended delegation note to $CLAUDE_MD"
fi

say "8/8 Model catalog"
if node "$ROOT/packages/mcp-facade/dist/refresh-models-cli.js"; then
  ok "model catalog refreshed"
else
  warn "catalog refresh incomplete — static fallbacks will be used; re-run scripts/update-models.sh later"
fi

say "Done"
echo "  Restart any running Claude Code session, then call occ_health."
echo "  Catalog: ${OCC_CATALOG_PATH:-$HOME/.occ/model-catalog.json}"
echo "  ACP (editors like Zed):  node packages/acp/dist/stdio.js --agent grok"
echo "  A2A (agent-to-agent):    node packages/a2a/dist/server-cli.js --agent grok --port 7003"
echo "  Control plane daemon:    node packages/control-plane/dist/cli.js up   (registry on :7100)"
