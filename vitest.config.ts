import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@occ/core": `${root}packages/core/src/index.ts`,
      "@occ/adapter-codex": `${root}packages/adapters/codex/src/index.ts`,
    },
  },
  test: {
    include: [
      "packages/core/test/**/*.test.ts",
      "packages/adapters/*/test/**/*.test.ts",
      "packages/mcp-facade/test/**/*.test.ts",
    ],
  },
});
