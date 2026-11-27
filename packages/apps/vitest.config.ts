import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import tailwindcss from "@tailwindcss/vite";
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

/** DIAG #2266: temporary — log page crash/close and browser disconnect events. */
function diag2266Provider<T extends { providerFactory: (project: never) => unknown }>(
  provider: T,
): T {
  const factory = provider.providerFactory.bind(provider);
  provider.providerFactory = ((project: never) => {
    const instance = factory(project) as {
      openBrowserPage: (sessionId: string, options: unknown) => Promise<unknown>;
    };
    const open = instance.openBrowserPage.bind(instance);
    instance.openBrowserPage = async (sessionId, options) => {
      const page = (await open(sessionId, options)) as {
        on: (event: string, cb: (...args: unknown[]) => void) => void;
        context: () => { browser: () => { on: (e: string, cb: () => void) => void } | null };
      };
      const stamp = () => new Date().toISOString();
      page.on("crash", () =>
        console.error(`[diag-2266 ${stamp()}] PAGE CRASH session=${sessionId}`),
      );
      page.on("close", () =>
        console.error(`[diag-2266 ${stamp()}] page close session=${sessionId}`),
      );
      page.on("pageerror", (err) =>
        console.error(
          `[diag-2266 ${stamp()}] pageerror session=${sessionId} ${String(err).slice(0, 300)}`,
        ),
      );
      page.on("frameattached", () => undefined);
      page
        .context()
        .browser()
        ?.on("disconnected", () => console.error(`[diag-2266 ${stamp()}] BROWSER DISCONNECTED`));
      return page;
    };
    return instance;
  }) as T["providerFactory"];
  return provider;
}

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
          {
            // DIAG #2266: temporary — find what drops every Vite WebSocket mid-run.
            name: "diag-2266-vite-lifecycle",
            configureServer(server) {
              const t0 = Date.now();
              const log = (msg: string) =>
                console.error(`[diag-2266 +${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);
              const origRestart = server.restart.bind(server);
              server.restart = async (...args) => {
                log(`server.restart called\n${new Error("restart").stack}`);
                return origRestart(...args);
              };
              const origClose = server.close.bind(server);
              server.close = async () => {
                log(`server.close called\n${new Error("close").stack}`);
                return origClose();
              };
              server.watcher?.on("all", (event, file) => log(`watcher ${event} ${file}`));
              server.httpServer?.on("close", () => log("httpServer close"));
              server.httpServer?.on("clientError", (err) =>
                log(`httpServer clientError ${String(err)}`),
              );
              const hot = server.hot as unknown as { send: (...a: unknown[]) => void };
              const origSend = hot.send.bind(hot);
              hot.send = (...a: unknown[]) => {
                const payload = a[0] as { type?: string } | string;
                const type = typeof payload === "string" ? payload : payload?.type;
                if (type !== "custom") log(`hot.send ${JSON.stringify(payload).slice(0, 300)}`);
                return origSend(...a);
              };
              server.ws.on(
                "connection",
                (socket: { on: (e: string, f: (...x: unknown[]) => void) => void }) => {
                  socket.on("close", (code: unknown, reason: unknown) =>
                    log(`vite ws client close code=${String(code)} reason=${String(reason)}`),
                  );
                },
              );
              process.on("warning", (w) => log(`process warning ${w.name}: ${w.message}`));
            },
          },
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
          browser: {
            enabled: true,
            headless: true,
            // Avoid Chromium /dev/shm OOM crashes that surface as Vitest
            // "Browser connection was closed" drops in CI (#1037).
            provider: diag2266Provider(
              playwright({
                launch: {
                  args: ["--disable-dev-shm-usage"],
                },
              }),
            ),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
