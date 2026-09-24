import { expect, test, type Page } from "@playwright/test";

const installBaseURL = process.env.WGW_INSTALL_BASE_URL ?? process.env.WGW_API_BASE_URL ?? "http://127.0.0.1:9080";
const adminUser = process.env.WGW_E2E_ADMIN_USER ?? "admin";
const adminPass = process.env.WGW_E2E_ADMIN_PASS ?? "longpassword99";
const adminEmail = process.env.WGW_E2E_ADMIN_EMAIL ?? "admin@e2e.test";
const database = process.env.WGW_E2E_DB ?? "sqlite";

expect.configure({ timeout: 15_000 });

async function assertInstallerNotInstalled(page: Page): Promise<void> {
  const response = await page.request.get("/api/v1/installer/state");
  expect(response.ok(), "installer state must respond before the wizard starts").toBe(true);
  const body = (await response.json()) as { installed?: boolean };
  expect(body.installed, "fresh install requires an uninstalled tree").toBe(false);
}

test.describe("Fresh install", () => {
  test.use({
    baseURL: installBaseURL,
    ignoreHTTPSErrors: true,
  });

  test("installs a fresh release and signs in", async ({ page }) => {
    test.setTimeout(300_000);

    await assertInstallerNotInstalled(page);

    await page.goto("/install/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "Get started" })).toBeVisible();
    await page.getByRole("button", { name: "Get started" }).click();

    await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
    await expect(page.getByText("Needs attention.")).toHaveCount(0);

    if (database === "sqlite") {
      await page.getByRole("group", { name: "Type" }).getByRole("button", { name: "SQLite" }).click();
    } else {
      await page.getByLabel("Host", { exact: true }).fill(process.env.WGW_E2E_DB_HOST ?? "127.0.0.1");
      await page.getByLabel("Port", { exact: true }).fill(process.env.WGW_E2E_DB_PORT ?? "3306");
      await page.getByLabel("Database", { exact: true }).fill(process.env.WGW_E2E_DB_NAME ?? "wgw");
      await page.getByLabel("User", { exact: true }).fill(process.env.WGW_E2E_DB_USER ?? "wgw");
      await page.getByLabel("Password", { exact: true }).fill(process.env.WGW_E2E_DB_PASSWORD ?? "wgw");
    }
    await page.getByRole("button", { name: "Continue" }).click();

    await page.getByLabel("Username", { exact: true }).fill(adminUser);
    await page.getByLabel("Email", { exact: true }).fill(adminEmail);
    await page.getByLabel("Password", { exact: true }).fill(adminPass);
    await page.getByRole("button", { name: "Create workspace" }).click();

    await expect(page.getByText("Your workspace is ready.")).toBeVisible({ timeout: 120_000 });
    await page.getByRole("button", { name: "Open workspace" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/install"), { timeout: 30_000 });

    const accessToken = await page.evaluate(() => window.localStorage.getItem("wgw.api.access_token"));
    expect(accessToken, "Open workspace stores the access token").toBeTruthy();

    const me = await page.request.get("/api/v1/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(me.status()).toBe(200);
    const body = (await me.json()) as { data?: { username?: string }; username?: string };
    const username = body.data?.username ?? body.username;
    expect(username).toBe(adminUser);
  });
});
