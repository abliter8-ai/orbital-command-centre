#requires -Version 5.1
<#
.SYNOPSIS
  Refresh the live model catalog for every installed agent CLI.

.DESCRIPTION
  Probes codex (config default), cursor-agent (--list-models), agy (models),
  grok (models, clean env) and claude (--version; aliases stay curated - no
  non-interactive listing), then writes ~\.occ\model-catalog.json
  (override with OCC_CATALOG_PATH). The MCP server reads the catalog at
  startup - restart Claude Code (or the orbital server) to pick up fresh slugs.

.EXAMPLE
  pwsh scripts/update-models.ps1
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Cli = Join-Path $Root "packages\mcp-facade\dist\refresh-models-cli.js"

if (-not (Test-Path $Cli)) {
  Write-Host "dist not built - running pnpm build first"
  Push-Location $Root
  try { pnpm build } finally { Pop-Location }
}

& node $Cli
exit $LASTEXITCODE
