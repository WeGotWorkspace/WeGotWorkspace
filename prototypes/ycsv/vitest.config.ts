import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      // spike 11: run the upstream spreadsheet-core parser/engine without its React UI.
      { find: "@/spreadsheet-core/src/formula-suggest", replacement: here("./interop/adapters/formula-suggest-stub.ts") },
      { find: /^@\//, replacement: here("./upstream/") },
    ],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "interop/**/*.test.ts"],
    passWithNoTests: true,
  },
});
