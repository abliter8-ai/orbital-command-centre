#requires -Version 5.1
<#
.SYNOPSIS
  Orbital Command Centre — installer (Windows PowerShell / pwsh).

.DESCRIPTION
  1. Checks Node >= 22 and pnpm 10 (tries corepack if pnpm is missing)
  2. pnpm install / build / test
  3. Checks the underlying coding CLIs (codex, cursor-agent, grok, agy) against
     OCC's tested minimum versions; -UpgradeClis runs each CLI's own `update`
  4. Registers the orbital MCP server with Claude Code (absolute path)
  5. Grants the orbital MCP tools in ~\.claude\settings.json (backup first)
  6. Links the delegating-to-* and choosing-the-right-agent skills into
     ~\.claude\skills (copies if the
     symlink needs privileges you do not have)
  7. Appends a short "delegate to save tokens" pointer to ~\.claude\CLAUDE.md
  8. Refreshes the live model catalog (~\.occ\model-catalog.json)

.EXAMPLE
  pwsh scripts/install.ps1
  pwsh scripts/install.ps1 -SkipTests -UpgradeClis
#>
[CmdletBinding()]
param(
  [switch]$SkipTests,
  [switch]$UpgradeClis,
  [switch]$NoMcp,
  [switch]$NoSkills,
  [switch]$NoClaudeMd
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$SkillsTarget = Join-Path $HOME ".claude\skills"
$ClaudeSettings = Join-Path $HOME ".claude\settings.json"
$ClaudeMd = Join-Path $HOME ".claude\CLAUDE.md"

function Say($msg)  { Write-Host "`n== $msg" -ForegroundColor White }
function Ok($msg)   { Write-Host "  ✓ $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "  ! $msg" -ForegroundColor Yellow }
function Die($msg)  { Write-Host "  ✗ $msg" -ForegroundColor Red; exit 1 }

function Test-VersionGe([string]$A, [string]$B) {
  $pa = @(($A -split '[.-]') | ForEach-Object { [int]($_ -replace '\D.*$', '') })
  $pb = @(($B -split '[.-]') | ForEach-Object { [int]($_ -replace '\D.*$', '') })
  $len = [Math]::Max($pa.Count, $pb.Count)
  for ($i = 0; $i -lt $len; $i++) {
    $ai = 0; if ($i -lt $pa.Count) { $ai = $pa[$i] }
    $bi = 0; if ($i -lt $pb.Count) { $bi = $pb[$i] }
    if ($ai -gt $bi) { return $true }
    if ($ai -lt $bi) { return $false }
  }
  return $true
}

Say "1/8 Toolchain"
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Die "node not found. Install Node >= 22 (https://nodejs.org or nvm-windows)." }
$nodeVersion = (node -v).TrimStart('v')
if (-not (Test-VersionGe $nodeVersion "22.0.0")) { Die "node $nodeVersion is too old — need >= 22." }
Ok "node v$nodeVersion"

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Warn "pnpm not found — trying corepack"
  try { corepack enable | Out-Null } catch { Die "corepack unavailable. Install pnpm 10: npm i -g pnpm@10" }
  try { corepack prepare pnpm@10 --activate | Out-Null } catch { Die "could not activate pnpm 10" }
}
$pnpmVersion = (pnpm -v)
if (-not (Test-VersionGe $pnpmVersion "10.0.0")) { Die "pnpm $pnpmVersion is too old — need >= 10 (corepack prepare pnpm@10 --activate)." }
Ok "pnpm $pnpmVersion"

Say "2/8 Build"
Push-Location $Root
try {
  pnpm install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { Die "pnpm install failed" }
  pnpm build
  if ($LASTEXITCODE -ne 0) { Die "pnpm build failed" }
  if (-not $SkipTests) {
    pnpm test
    if ($LASTEXITCODE -ne 0) { Die "pnpm test failed" }
    Ok "tests passed"
  } else {
    Warn "tests skipped (-SkipTests)"
  }
} finally {
  Pop-Location
}

Say "3/8 Coding CLIs"
$Clis = @(
  @{ Name = "codex";       Bin = "codex";       Min = "0.148.0";    Hint = "npm i -g @openai/codex  (then: codex login)" },
  @{ Name = "cursor";      Bin = "cursor-agent"; Min = "2026.08.11"; Hint = "https://cursor.com/install  (then: cursor-agent login)" },
  @{ Name = "grok";        Bin = "grok";        Min = "1.0.5";      Hint = "see https://grok.com/cli  (then: grok login)" },
  @{ Name = "antigravity"; Bin = "agy";         Min = "1.1.15";     Hint = "see https://antigravity.google  (then: run agy once to cache OAuth)" }
)
$anyCli = $false
foreach ($cli in $Clis) {
  if (-not (Get-Command $cli.Bin -ErrorAction SilentlyContinue)) {
    Warn "$($cli.Name): '$($cli.Bin)' not on PATH — $($cli.Hint)"
    continue
  }
  $raw = (& $cli.Bin --version 2>$null | Select-Object -First 1)
  $m = [regex]::Match("$raw", '[0-9]+(\.[0-9]+)+(-[0-9a-f]+)?')
  if (-not $m.Success) {
    Warn "$($cli.Name): could not parse version from '$raw'"
    continue
  }
  $version = $m.Value
  if (Test-VersionGe $version $cli.Min) {
    Ok "$($cli.Name) $version (>= $($cli.Min) tested)"
  } else {
    Warn "$($cli.Name) $version is older than the tested $($cli.Min)"
    if ($UpgradeClis) {
      Say "    upgrading $($cli.Name) via '$($cli.Bin) update'"
      & $cli.Bin update
      if ($LASTEXITCODE -ne 0) { Warn "$($cli.Name) self-update failed — update it manually" }
    } else {
      Warn "    re-run with -UpgradeClis, or: $($cli.Bin) update"
    }
  }
  $anyCli = $true
}
if (-not $anyCli) { Warn "no coding CLIs found — install at least one before delegating" }

Say "4/8 MCP registration (Claude Code)"
$stdio = Join-Path $Root "packages\mcp-facade\dist\stdio.js"
if ($NoMcp) {
  Warn "skipped (-NoMcp)"
} elseif (Get-Command claude -ErrorAction SilentlyContinue) {
  & claude mcp get orbital 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { & claude mcp remove orbital 2>$null | Out-Null }
  & claude mcp add orbital -- node $stdio
  if ($LASTEXITCODE -ne 0) { Die "claude mcp add failed" }
  Ok "claude mcp add orbital -- node $stdio"
} else {
  Warn "'claude' CLI not found — register manually later:"
  Warn "  claude mcp add orbital -- node `"$stdio`""
}

Say "5/8 Tool permissions"
$settingsDir = Split-Path $ClaudeSettings -Parent
if (-not (Test-Path $settingsDir)) { New-Item -ItemType Directory -Path $settingsDir | Out-Null }
if (Test-Path $ClaudeSettings) {
  Copy-Item $ClaudeSettings "$ClaudeSettings.bak-$(Get-Date -Format yyyyMMddHHmmss)"
}
$mergeScript = @'
const fs = require("node:fs");
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
'@
$mergeScript | node - $ClaudeSettings
if ($LASTEXITCODE -ne 0) { Die "settings merge failed" }
Ok "permissions.allow updated (backup written if a file existed)"

Say "6/8 Skills"
if ($NoSkills) {
  Warn "skipped (-NoSkills)"
} else {
  if (-not (Test-Path $SkillsTarget)) { New-Item -ItemType Directory -Path $SkillsTarget -Force | Out-Null }
  Get-ChildItem -Path (Join-Path $Root "skills") -Directory |
    Where-Object { $_.Name -like "delegating-to-*" -or $_.Name -eq "choosing-the-right-agent" } |
    ForEach-Object {
    $dest = Join-Path $SkillsTarget $_.Name
    $linked = $false
    try {
      if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
      New-Item -ItemType SymbolicLink -Path $dest -Target $_.FullName -ErrorAction Stop | Out-Null
      $linked = $true
    } catch {
      if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
      Copy-Item $_.FullName $dest -Recurse
    }
    if ($linked) { Ok "linked $($_.Name) -> $dest" } else { Ok "copied $($_.Name) -> $dest (symlink needs Developer Mode or admin)" }
  }
}

Say "7/8 CLAUDE.md note"
if ($NoClaudeMd) {
  Warn "skipped (-NoClaudeMd)"
} elseif ((Test-Path $ClaudeMd) -and (Select-String -Path $ClaudeMd -Pattern '<!-- orbital-occ -->' -SimpleMatch -Quiet)) {
  Ok "CLAUDE.md already has the orbital note"
} else {
  $claudeMdDir = Split-Path $ClaudeMd -Parent
  if (-not (Test-Path $claudeMdDir)) { New-Item -ItemType Directory -Path $claudeMdDir -Force | Out-Null }
  $note = @"

<!-- orbital-occ -->
## Orbital OCC delegation
Save context tokens: delegate implementation, investigation, and research to the orbital MCP tools ``delegate_to_codex`` / ``delegate_to_cursor`` / ``delegate_to_grok`` / ``delegate_to_antigravity`` instead of doing it in-context (check ``occ_health`` first; ``occ_capabilities`` shows who owns what, ``occ_models`` the live model lists).
Grok also does what this harness cannot: ``grok_x_search`` (live X posts), ``grok_imagine`` (image gen/edit), ``grok_video`` (short video from a still).
"@
  Add-Content -Path $ClaudeMd -Value $note -Encoding UTF8
  Ok "appended delegation note to $ClaudeMd"
}

Say "8/8 Model catalog"
& node (Join-Path $Root "packages\mcp-facade\dist\refresh-models-cli.js")
if ($LASTEXITCODE -eq 0) {
  Ok "model catalog refreshed"
} else {
  Warn "catalog refresh incomplete — static fallbacks will be used; re-run scripts/update-models.ps1 later"
}

Say "Done"
$catalogPath = if ($env:OCC_CATALOG_PATH) { $env:OCC_CATALOG_PATH } else { Join-Path $HOME ".occ\model-catalog.json" }
Write-Host "  Restart any running Claude Code session, then call occ_health."
Write-Host "  Catalog: $catalogPath"
Write-Host "  ACP (editors like Zed):  node packages/acp/dist/stdio.js --agent grok"
Write-Host "  A2A (agent-to-agent):    node packages/a2a/dist/server-cli.js --agent grok --port 7003"
Write-Host "  Control plane daemon:    node packages/control-plane/dist/cli.js up   (registry on :7100)"
