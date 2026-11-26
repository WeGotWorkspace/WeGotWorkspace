import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.SB_PORT ?? 6017);

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  workers: 4,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1100, height: 700 },
    permissions: ["clipboard-read", "clipboard-write"],
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1100, height: 700 } }, testIgnore: /touch|safari/ },
    { name: "touch", use: { ...devices["Pixel 7"] }, testMatch: /touch/ },
  ],
  webServer: {
    command: `pnpm exec storybook dev -p ${PORT} --no-open --ci`,
    port: PORT,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
