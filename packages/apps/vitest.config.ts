import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import tsconfigPaths from "vite-tsconfig-paths";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiGeneratedRoot = path.resolve(__dirname, "../api/openapi/generated");
const storybookVitestTags =
  process.env.STORYBOOK_VITEST_SMOKE === "1"
    ? { include: ["vitest-ci"] }
    : { include: ["test"], exclude: ["live"] };

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@wgw-api-generated": apiGeneratedRoot,
    },
  },
  test: {
    projects: [
      {
        resolve: {
          alias: {
            "@": path.resolve(__dirname, "src"),
            "@wgw-api-generated": apiGeneratedRoot,
          },
        },
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        resolve: {
          alias: {
            "@": path.resolve(__dirname, "src"),
            "@wgw-api-generated": apiGeneratedRoot,
          },
        },
        test: {
          name: "jsdom",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          pool: "forks",
          maxWorkers: 1,
          setupFiles: [path.resolve(__dirname, "src/jsdom-setup.ts")],
        },
      },
      {
        define: {
          "import.meta.env.STORYBOOK_A11Y_GATE": JSON.stringify(
            process.env.STORYBOOK_A11Y_GATE ?? "",
          ),
        },
        resolve: {
          alias: {
            "@": path.resolve(__dirname, "src"),
            "@wgw-api-generated": apiGeneratedRoot,
          },
        },
        plugins: [
          storybookTest({
            configDir: path.join(__dirname, ".storybook"),
            tags: storybookVitestTags,
          }),
        ],
        test: {
          name: "storybook",
          testTimeout: 30_000,
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
