import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import tsconfigPaths from "vite-tsconfig-paths";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const storybookVitestTags =
  process.env.STORYBOOK_VITEST_SMOKE === "1"
    ? { include: ["vitest-ci"] }
    : { include: ["test"], exclude: ["live"] };

/**
 * Node 25+ enables Web Storage by default; without a backing file the global is a
 * broken proxy that shadows jsdom's Storage (`clear`/`getItem` undefined).
 * Disable it so jsdom (and `@vitest-environment jsdom` unit files) own Storage.
 * @see https://github.com/vitest-dev/vitest/issues/8757
 */
const nodeWebStorageExecArgv = ["--no-experimental-webstorage"];

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    execArgv: nodeWebStorageExecArgv,
    coverage: {
      provider: "v8",
      include: ["src/**"],
      // Stories and fixture mocks are not product dark spots. Vitest appends
      // its own excludes (tests, setup, config, node_modules) after this list.
      exclude: ["**/*.stories.*", "**/stories/**", "**/mock/**"],
    },
    projects: [
      {
        resolve: {
          alias: {
            "@": path.resolve(__dirname, "src"),
          },
        },
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
          execArgv: nodeWebStorageExecArgv,
        },
      },
      {
        resolve: {
          alias: {
            "@": path.resolve(__dirname, "src"),
          },
        },
        test: {
          name: "jsdom",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          pool: "forks",
          maxWorkers: 1,
          execArgv: nodeWebStorageExecArgv,
          setupFiles: [path.resolve(__dirname, "src/jsdom-setup.ts")],
        },
      },
      {
        define: {
          "import.meta.env.STORYBOOK_A11Y_GATE": JSON.stringify(
            process.env.STORYBOOK_A11Y_GATE ?? "",
          ),
          // preview.ts sets html[data-chromatic-reduced-motion] so Radix Presence
          // does not hang on paused animationend during story play functions.
          "import.meta.env.STORYBOOK_REDUCED_MOTION": JSON.stringify("1"),
        },
        resolve: {
          alias: {
            "@": path.resolve(__dirname, "src"),
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
