#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));

if (args.includes("--version") || args[0] === "--version") {
  process.stdout.write("codex-cli 0.148.0-fake\n");
  process.exit(0);
}

if (process.env.FAKE_CODEX_LOGIN === "1") {
  process.stderr.write("Error: not logged in. Run `codex login`.\n");
  process.exit(1);
}

const fixture =
  process.env.FAKE_CODEX_FIXTURE ?? path.join(here, "exec-success.jsonl");
const text = fs.readFileSync(fixture, "utf8");
process.stdout.write(text);

const oIdx = args.indexOf("-o");
if (oIdx >= 0 && args[oIdx + 1]) {
  const last = process.env.FAKE_CODEX_LAST_MESSAGE ?? "Done from last-message file.";
  fs.writeFileSync(args[oIdx + 1], `${last}\n`);
}

process.exit(process.env.FAKE_CODEX_FAIL === "1" ? 1 : 0);
