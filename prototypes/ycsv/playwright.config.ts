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
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1100, height: 700 } }, testIgnore: /e2e\/(\d-touch|touch-perf|touch-shots|safari)/ },
    { name: "touch", use: { ...devices["Pixel 7"] }, testMatch: /7-touch/ },
    // Spike 7: phones and tablets in both engines.
    { name: "android-phone", use: { ...devices["Pixel 7"] }, testMatch: /e2e\/(8-touch|touch-shots)/ },
    { name: "android-tablet", use: { ...devices["Galaxy Tab S4"] }, testMatch: /e2e\/(8-touch|touch-shots)/ },
    { name: "iphone", use: { ...devices["iPhone 15"], permissions: [] }, testMatch: /e2e\/(8-touch|touch-shots)/ },
    { name: "ipad", use: { ...devices["iPad Pro 11"], permissions: [] }, testMatch: /e2e\/(8-touch|touch-shots)/ },
    { name: "touch-perf", use: { ...devices["Pixel 7"] }, testMatch: /touch-perf/ },
    // Cross-browser picture (not in test:e2e): clipboard permissions are Chromium-only.
    { name: "firefox", use: { ...devices["Desktop Firefox"], viewport: { width: 1100, height: 700 }, permissions: [] }, testIgnore: /e2e\/(\d-touch|touch-perf|touch-shots)/ },
    { name: "webkit", use: { ...devices["Desktop Safari"], viewport: { width: 1100, height: 700 }, permissions: [] }, testIgnore: /e2e\/(\d-touch|touch-perf|touch-shots)/ },
  ],
  webServer: {
    command: `pnpm exec storybook dev -p ${PORT} --no-open --ci`,
    port: PORT,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
