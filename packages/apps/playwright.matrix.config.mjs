import { defineConfig } from "@playwright/test";
import live from "./playwright.live.config.mjs";
import {
  calendarSyncMatrixSpecPattern,
  contactsSyncMatrixSpecPattern,
  docsSyncMatrixSpecPattern,
  meetChatSyncMatrixSpecPattern,
  notesSyncMatrixSpecPattern,
  tasksSyncMatrixSpecPattern,
} from "./e2e/live-tier.mjs";

const ci = !!process.env.CI;

/**
 * `WGW_E2E_PRODUCTION_BUILD=1` serves the production build (`vite build`, then
 * `vite preview` on the base URL's port) instead of the dev server, for the
 * cases that reload offline: only the built service worker serves the app
 * shell with no network. Point `WGW_APPS_E2E_BASE_URL` at a free port for it.
 */
const productionBuild = process.env.WGW_E2E_PRODUCTION_BUILD === "1";

function productionAppServer(server) {
  const port = new URL(String(live.use?.baseURL)).port;
  const apps = "pnpm --filter @wgw/apps exec";
  return {
    ...server,
    command: server.command.replace(
      "pnpm --filter @wgw/apps run dev:app",
      `${apps} vite build && ${apps} vite preview --port ${port} --strictPort --host 127.0.0.1`,
    ),
    timeout: 300_000,
  };
}

/**
 * The Notes, Tasks, Docs, Contacts, Calendar and Meet chat sync matrices on
 * the live tier (same servers and setup as `playwright.live.config.mjs`). One case drives up to two browsers and waits
 * for a reconnect, so a case gets more time than a live spec.
 *
 * `fullyParallel` lets `--shard` split the cases of one spec file (CI runs
 * each matrix in its own shards and names the spec); `workers: 1` from the
 * live config still runs them one by one.
 * On CI, `maxFailures` stops a broken environment after a few cases, and
 * `globalTimeout` ends a slow shard with a report before the job timeout.
 * The list reporter prints each case's duration, and Vite's own log (dep
 * re-bundling, page reloads) goes to the job output.
 */
export default defineConfig({
  ...live,
  testMatch: [
    notesSyncMatrixSpecPattern,
    tasksSyncMatrixSpecPattern,
    docsSyncMatrixSpecPattern,
    contactsSyncMatrixSpecPattern,
    calendarSyncMatrixSpecPattern,
    meetChatSyncMatrixSpecPattern,
  ],
  timeout: 180_000,
  fullyParallel: true,
  maxFailures: ci ? 3 : 0,
  globalTimeout: ci ? 50 * 60_000 : 0,
  reporter: ci ? [["list"], ["html", { open: "never" }]] : "list",
  webServer: live.webServer?.map((server) => {
    if (server.url !== live.use?.baseURL) return server;
    const app = { ...server, stdout: "pipe" };
    return productionBuild ? productionAppServer(app) : app;
  }),
});
