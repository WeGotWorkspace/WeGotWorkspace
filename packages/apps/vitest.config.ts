import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const storybookVitestSmoke = process.env.STORYBOOK_VITEST_SMOKE === "1";
const storybookVitestTags = storybookVitestSmoke
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
      include: ["src/**/*.{ts,tsx}"],
      // Stories, mocks, tests, and the jsdom setup file are not product dark
      // spots. Vitest 4 appends the root test include after this list, which
      // already dropped *.test.* in a unit run. Project setupFiles are not on
      // that root list, so src/jsdom-setup.ts was still reported.
      exclude: [
        "**/*.stories.*",
        "**/stories/**",
        "**/mock/**",
        "**/*.test.*",
        "**/*.spec.*",
        "**/*.d.ts",
        "src/jsdom-setup.ts",
      ],
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
          // lib/offline reads and seeds collab documents through the editor (#2116).
          setupFiles: [path.resolve(__dirname, "src/provide-collab-content-codec.ts")],
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
          setupFiles: [
            path.resolve(__dirname, "src/jsdom-setup.ts"),
            path.resolve(__dirname, "src/provide-collab-content-codec.ts"),
          ],
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
          // Same CSS as Storybook dev and Chromatic: without it every `@apply`
          // body is empty and the a11y gate checks half-styled components.
          tailwindcss(),
          storybookTest({
            configDir: path.join(__dirname, ".storybook"),
            tags: storybookVitestTags,
          }),
        ],
        test: {
          name: "storybook",
          testTimeout: 30_000,
          // Smoke run (CI): all story files share one iframe per browser page.
          // With isolation, every file gets a fresh iframe, and after roughly
          // 60–150 heavy story files on one page Chromium resets all of that
          // page's connections: "Browser connection was closed" (#2266). CI's
          // 4 vCPUs give 3 pages of ~85 files each, so the queue lost the page
          // on most runs. It was not memory, disk, GC, HMR sockets, or one
          // story; turning isolation off is what stops it, and the run is
          // about twice as fast. Trade-off: CSS that a story file imports stays
          // in the shared iframe, so a story can now see an earlier file's
          // styles. The full local `test:storybook` run keeps isolation.
          isolate: !storybookVitestSmoke,
          browser: {
            enabled: true,
            headless: true,
            // Playwright passes this flag by default too. It did not stop the
            // "Browser connection was closed" drops (#1037, #2266); see isolate.
            provider: playwright({
              launch: {
                args: ["--disable-dev-shm-usage"],
              },
            }),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
