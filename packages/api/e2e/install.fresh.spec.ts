import { expect, test, type Locator, type Page } from "@playwright/test";

const installBaseURL = process.env.WGW_INSTALL_BASE_URL;
const dbDriver = (process.env.WGW_E2E_DB ?? "sqlite") as "sqlite" | "mysql";
const adminUsername = process.env.WGW_E2E_ADMIN_USERNAME ?? "admin";
const adminPassword = process.env.WGW_E2E_ADMIN_PASSWORD ?? "longpassword99";
const adminEmail = process.env.WGW_E2E_ADMIN_EMAIL ?? "admin@e2e.test";
const adminDisplayName = process.env.WGW_E2E_ADMIN_DISPLAY_NAME ?? "E2E Admin";
const mysqlHost = process.env.WGW_E2E_MYSQL_HOST ?? "127.0.0.1";
const mysqlPort = process.env.WGW_E2E_MYSQL_PORT ?? "3306";
const mysqlDatabase = process.env.WGW_E2E_MYSQL_DATABASE ?? "wgw";
const mysqlUsername = process.env.WGW_E2E_MYSQL_USERNAME ?? "wgw";
const mysqlPassword = process.env.WGW_E2E_MYSQL_PASSWORD ?? "wgw";

function labeledInput(page: Page, label: string): Locator {
  return page.locator(".field-label-row", { hasText: label }).locator("input").first();
}

async function clickContinue(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Continue" }).click();
}

async function waitForStep(page: Page, title: string): Promise<void> {
  await expect(page.getByRole("heading", { name: title })).toBeVisible({
    timeout: 30_000,
  });
}

test.describe("Fresh install wizard", () => {
  test.skip(
    process.env.WGW_INSTALL_FRESH !== "1",
    "Set WGW_INSTALL_FRESH=1 (via pnpm test:install-e2e) to walk a virgin artifact.",
  );

  test.use({
    baseURL: installBaseURL ?? "http://127.0.0.1:9080",
    ignoreHTTPSErrors: true,
  });

  test("wizard creates an admin who can sign in", async ({ page, request }) => {
    if (!installBaseURL) {
      throw new Error("WGW_INSTALL_BASE_URL is required when WGW_INSTALL_FRESH=1.");
    }
    const stateResponse = await request.get("/api/v1/installer/state");
    expect(stateResponse.ok()).toBeTruthy();
    const state = (await stateResponse.json()) as { installed?: boolean };
    if (state.installed === true) {
      throw new Error(
        "Workspace is already installed. install.fresh.spec.ts requires a virgin artifact (no silent skip).",
      );
    }

    await page.goto("/install/", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("What you'll set up")).toBeVisible({ timeout: 20_000 });
    await waitForStep(page, "Welcome");
    await clickContinue(page);

    await waitForStep(page, "Check your server");
    await expect(page.getByText(/^\d+ checks passed$/)).toBeVisible({ timeout: 30_000 });
    await clickContinue(page);

    await waitForStep(page, "Pick a database");
    if (dbDriver === "mysql") {
      await page.getByRole("button", { name: /MySQL \/ MariaDB/ }).click();
      await labeledInput(page, "Host").fill(mysqlHost);
      await labeledInput(page, "Port").fill(mysqlPort);
      await labeledInput(page, "Database name").fill(mysqlDatabase);
      await labeledInput(page, "Username").fill(mysqlUsername);
      await labeledInput(page, "Password").fill(mysqlPassword);
    } else {
      await page.getByRole("button", { name: "SQLite" }).click();
    }
    await clickContinue(page);

    await waitForStep(page, "Enable Files, Contacts & Calendars");
    await clickContinue(page);

    await waitForStep(page, "Mail server");
    await page.getByRole("button", { name: "Skip for now" }).click();

    await waitForStep(page, "Meet");
    await page.getByRole("button", { name: "Skip for now" }).click();

    await waitForStep(page, "Create admin account");
    await page.getByPlaceholder("admin").fill(adminUsername);
    await page.getByPlaceholder("Jane Doe").fill(adminDisplayName);
    await page.getByPlaceholder("admin@example.com").fill(adminEmail);
    const passwords = page.getByPlaceholder("********");
    await passwords.nth(0).fill(adminPassword);
    await passwords.nth(1).fill(adminPassword);
    await page.getByRole("button", { name: "Finish install" }).click();

    const openAdmin = page.getByRole("button", { name: "Open admin panel" });
    const welcomeBack = page.getByRole("heading", { name: "Welcome back." });
    const usersGroups = page.getByText("Users & Groups");
    await expect(openAdmin.or(welcomeBack).or(usersGroups)).toBeVisible({ timeout: 60_000 });

    if (await openAdmin.isVisible()) {
      await openAdmin.click();
      await expect(welcomeBack.or(usersGroups)).toBeVisible({ timeout: 30_000 });
    }

    if (await welcomeBack.isVisible()) {
      await page.getByLabel("Username").fill(adminUsername);
      await page.getByLabel("Password").fill(adminPassword);
      await page.getByRole("button", { name: "Sign in" }).click();
    }

    await expect(usersGroups).toBeVisible({ timeout: 30_000 });

    const tokenResponse = await request.post("/api/v1/auth/token", {
      data: { username: adminUsername, password: adminPassword },
    });
    expect(tokenResponse.ok()).toBeTruthy();
    const tokenBody = (await tokenResponse.json()) as {
      username?: string;
      access_token?: string;
    };
    expect(tokenBody.username).toBe(adminUsername);
    expect(tokenBody.access_token).toBeTruthy();

    const writeResponse = await request.post(
      `/api/v1/files/directories?path=/users/${encodeURIComponent(adminUsername)}`,
      {
        headers: { Authorization: `Bearer ${tokenBody.access_token}` },
        data: { name: "e2e-install-proof" },
      },
    );
    expect(writeResponse.ok()).toBeTruthy();
  });
});
