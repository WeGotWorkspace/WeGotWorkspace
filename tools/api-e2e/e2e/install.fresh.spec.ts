import { expect, test, type Page } from "@playwright/test";

const installBaseURL = process.env.WGW_INSTALL_BASE_URL ?? process.env.WGW_API_BASE_URL ?? "http://127.0.0.1:9080";
const adminUser = process.env.WGW_E2E_ADMIN_USER ?? "admin";
const adminPass = process.env.WGW_E2E_ADMIN_PASS ?? "longpassword99";
const adminEmail = process.env.WGW_E2E_ADMIN_EMAIL ?? "admin@e2e.test";
const database = process.env.WGW_E2E_DB ?? "sqlite";

expect.configure({ timeout: 15_000 });

async function readInstallerInstalled(page: Page): Promise<boolean> {
  const response = await page.request.get("/api/v1/installer/state");
  if (!response.ok()) {
    return false;
  }
  const body = (await response.json()) as { installed?: boolean };
  return body.installed === true;
}

test.describe("Fresh install", () => {
  test.use({
    baseURL: installBaseURL,
    ignoreHTTPSErrors: true,
  });

  test("installs a fresh release and signs in", async ({ page }) => {
    test.setTimeout(300_000);

    expect(await readInstallerInstalled(page), "fresh install requires an uninstalled tree").toBe(false);

    await page.goto("/install/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "Get started" })).toBeVisible();
    await page.getByRole("button", { name: "Get started" }).click();

    await expect(page.getByText("Needs attention.")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();

    if (database === "sqlite") {
      await page.getByRole("group", { name: "Type" }).getByRole("button", { name: "SQLite" }).click();
    } else {
      await page.getByLabel("Host").fill(process.env.WGW_E2E_DB_HOST ?? "127.0.0.1");
      await page.getByLabel("Port").fill(process.env.WGW_E2E_DB_PORT ?? "3306");
      await page.getByLabel("Database").fill(process.env.WGW_E2E_DB_NAME ?? "wgw");
      await page.getByLabel("User").fill(process.env.WGW_E2E_DB_USER ?? "wgw");
      await page.getByLabel("Password").fill(process.env.WGW_E2E_DB_PASSWORD ?? "wgw");
    }
    await page.getByRole("button", { name: "Continue" }).click();

    await page.getByLabel("Username").fill(adminUser);
    await page.getByLabel("Email").fill(adminEmail);
    await page.getByLabel("Password").fill(adminPass);
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
