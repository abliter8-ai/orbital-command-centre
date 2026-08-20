#!/usr/bin/env node
// Exercises scripts/register-flip.mjs against a temp HOME: fresh create,
// idempotent re-run, malformed-JSON rebuild, and coexistence with existing
// config. Exits non-zero on the first failure. Run: pnpm test:scripts
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const register = join(root, "scripts", "register-flip.mjs");
const stdio = join(root, "packages", "mcp-facade", "dist", "stdio.js");

let failures = 0;
function check(name, cond) {
  if (cond) {
    process.stdout.write(`  ok ${name}\n`);
  } else {
    process.stderr.write(`  FAIL ${name}\n`);
    failures += 1;
  }
}

function run(target, file) {
  execFileSync(process.execPath, [register, target, file, stdio], { stdio: "pipe" });
}

const work = mkdtempSync(join(tmpdir(), "occ-register-flip-test-"));
try {
  // --- cursor: create, idempotent, malformed rebuild ---
  {
    const file = join(work, "cursor", "mcp.json");
    run("cursor", file);
    let cfg = JSON.parse(readFileSync(file, "utf8"));
    check("cursor: creates mcpServers.orbital", cfg.mcpServers?.orbital?.args?.[0] === stdio);

    cfg.mcpServers.other = { command: "x", args: [] };
    writeFileSync(file, JSON.stringify(cfg));
    run("cursor", file);
    cfg = JSON.parse(readFileSync(file, "utf8"));
    check("cursor: re-run keeps other servers", cfg.mcpServers.other?.command === "x");
    check("cursor: re-run keeps orbital", cfg.mcpServers.orbital?.args?.[0] === stdio);

    writeFileSync(file, "{ broken json");
    run("cursor", file);
    cfg = JSON.parse(readFileSync(file, "utf8"));
    check("cursor: malformed file rebuilt", cfg.mcpServers?.orbital?.args?.[0] === stdio);
  }

  // --- codex: create, idempotent section replace, other sections preserved ---
  {
    const file = join(work, "codex", "config.toml");
    run("codex", file);
    let text = readFileSync(file, "utf8");
    check("codex: creates [mcp_servers.orbital]", text.includes("[mcp_servers.orbital]"));

    text += `\n[profiles.fast]\nmodel = "gpt-5"\n`;
    writeFileSync(file, text);
    run("codex", file);
    text = readFileSync(file, "utf8");
    const occurrences = text.split("[mcp_servers.orbital]").length - 1;
    check("codex: re-run keeps a single orbital section", occurrences === 1);
    check("codex: re-run preserves other sections", text.includes("[profiles.fast]"));
  }

  // --- codepuppy: create with auto_start, idempotent, other servers preserved ---
  {
    const file = join(work, "codepuppy", "servers.json");
    run("codepuppy", file);
    let cfg = JSON.parse(readFileSync(file, "utf8"));
    check("codepuppy: creates servers.orbital", cfg.servers?.orbital?.args?.[0] === stdio);
    check("codepuppy: auto_start set", cfg.servers?.orbital?.auto_start === true);

    cfg.servers.sqlite = { command: "uvx", args: ["mcp-server-sqlite"], env: {}, auto_start: false };
    writeFileSync(file, JSON.stringify(cfg));
    run("codepuppy", file);
    cfg = JSON.parse(readFileSync(file, "utf8"));
    check("codepuppy: re-run keeps other servers", cfg.servers.sqlite?.command === "uvx");
    check("codepuppy: re-run keeps orbital", cfg.servers.orbital?.args?.[0] === stdio);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (failures > 0) {
  process.stderr.write(`${failures} check(s) failed\n`);
  process.exit(1);
}
process.stdout.write("register-flip: all checks passed\n");
