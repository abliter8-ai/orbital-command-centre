#!/usr/bin/env node
// Register the orbital MCP server with a non-Claude harness ("the flip").
//   node scripts/register-flip.mjs cursor <mcp.json path> <stdio.js path>
//   node scripts/register-flip.mjs codex  <config.toml path> <stdio.js path>
// Idempotent. Backs up any existing file to <file>.bak-<timestamp> first.
// Malformed JSON is backed up and rebuilt rather than silently merged.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const [target, file, stdio] = process.argv.slice(2);
if (!["cursor", "codex"].includes(target) || !file || !stdio) {
  process.stderr.write(
    "usage: node register-flip.mjs cursor|codex <config path> <stdio.js path>\n",
  );
  process.exit(2);
}

function backup() {
  if (!existsSync(file)) return;
  const dest = `${file}.bak-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}`;
  copyFileSync(file, dest);
  process.stdout.write(`  backup: ${dest}\n`);
}

function write(text) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

if (target === "cursor") {
  let config = {};
  let raw = "";
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    raw = "";
  }
  if (raw.trim() !== "") {
    backup();
    try {
      config = JSON.parse(raw);
    } catch {
      process.stdout.write("  existing mcp.json was not valid JSON — rebuilt (backup kept)\n");
      config = {};
    }
  }
  config.mcpServers = config.mcpServers ?? {};
  config.mcpServers.orbital = { command: "node", args: [stdio] };
  write(`${JSON.stringify(config, null, 2)}\n`);
  process.stdout.write(`  cursor: mcpServers.orbital -> node ${stdio}\n`);
} else {
  // TOML: replace an existing [mcp_servers.orbital] section, else append.
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    text = "";
  }
  if (existsSync(file)) backup();
  const block = `[mcp_servers.orbital]\ncommand = "node"\nargs = [${JSON.stringify(stdio)}]\n`;
  const section = /^\[mcp_servers\.orbital\][^\n]*\n(?:(?!\s*\[)[^\n]*\n?)*/m;
  if (section.test(text)) {
    text = text.replace(section, block);
  } else {
    if (text !== "" && !text.endsWith("\n")) text += "\n";
    text += `${text === "" ? "" : "\n"}${block}`;
  }
  write(text);
  process.stdout.write(`  codex: [mcp_servers.orbital] -> node ${stdio}\n`);
}
