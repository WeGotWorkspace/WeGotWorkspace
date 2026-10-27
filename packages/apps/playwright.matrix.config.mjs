import { defineConfig } from "@playwright/test";
import live from "./playwright.live.config.mjs";
import { notesSyncMatrixSpecPattern } from "./e2e/live-tier.mjs";

const ci = !!process.env.CI;

/**
 * The Notes sync matrix on the live tier (same servers and setup as
 * `playwright.live.config.mjs`). One case drives up to two browsers and waits
 * for a reconnect, so a case gets more time than a live spec.
 *
 * `fullyParallel` lets `--shard` split the cases of the one spec file (CI runs
 * it in shards); `workers: 1` from the live config still runs them one by one.
 * On CI, `maxFailures` stops a broken environment after a few cases, and
 * `globalTimeout` ends a slow shard with a report before the job timeout.
 * The list reporter prints each case's duration, and Vite's own log (dep
 * re-bundling, page reloads) goes to the job output.
 */
export default defineConfig({
  ...live,
  testMatch: notesSyncMatrixSpecPattern,
  timeout: 180_000,
  fullyParallel: true,
  maxFailures: ci ? 3 : 0,
  globalTimeout: ci ? 50 * 60_000 : 0,
  reporter: ci ? [["list"], ["html", { open: "never" }]] : "list",
  webServer: live.webServer?.map((server) =>
    server.url === live.use?.baseURL ? { ...server, stdout: "pipe" } : server,
  ),
});
