import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@occ/core": `${root}packages/core/src/index.ts`,
      "@occ/adapter-kit": `${root}packages/adapters/kit/src/index.ts`,
      "@occ/adapter-codex": `${root}packages/adapters/codex/src/index.ts`,
      "@occ/adapter-cursor": `${root}packages/adapters/cursor/src/index.ts`,
      "@occ/adapter-grok": `${root}packages/adapters/grok/src/index.ts`,
      "@occ/adapter-antigravity": `${root}packages/adapters/antigravity/src/index.ts`,
      "@occ/acp": `${root}packages/acp/src/index.ts`,
      "@occ/a2a": `${root}packages/a2a/src/index.ts`,
      "@occ/control-plane": `${root}packages/control-plane/src/index.ts`,
    },
  },
  test: {
    include: [
      "packages/core/test/**/*.test.ts",
      "packages/adapters/*/test/**/*.test.ts",
      "packages/mcp-facade/test/**/*.test.ts",
      "packages/acp/test/**/*.test.ts",
      "packages/a2a/test/**/*.test.ts",
      "packages/control-plane/test/**/*.test.ts",
    ],
  },
});
