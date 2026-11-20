// #2315: changing the password in one browser ends the session in every browser.
// Both land on the sign-in form (no error page) and the new password works.
import { expect, test, type Browser, type BrowserContext, type Page } from "./helpers/live-test";
import { passwordFor, TEAMMATE } from "./helpers/live-matrix";

const API = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";
const APP = process.env.WGW_APPS_E2E_BASE_URL ?? "http://127.0.0.1:5173";
const ORIGINAL = passwordFor(TEAMMATE);
const CHANGED = `changed-${Date.now().toString(36)}-pw`;

test.use({ storageState: { cookies: [], origins: [] } });

async function signIn(page: Page, password: string): Promise<void> {
  await page.getByLabel("Username").fill(TEAMMATE);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function openSignedIn(browser: Browser, path: string): Promise<BrowserContext> {
  const context = await browser.newContext({
    baseURL: APP,
    storageState: { cookies: [], origins: [] },
    viewport: { width: 1400, height: 900 },
  });
  const page = await context.newPage();
  await page.goto(path);
  await signIn(page, ORIGINAL);
  await expect(page.locator("#password")).toHaveCount(0, { timeout: 30_000 });
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
  return context;
}

/** Puts the original password back through the API, whichever password works now. */
async function restorePassword(): Promise<void> {
  for (const [from, to] of [
    [CHANGED, ORIGINAL],
    [ORIGINAL, ORIGINAL],
  ] as const) {
    const token = await fetch(`${API}/api/v1/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: TEAMMATE, password: from }),
    });
    if (!token.ok) continue;
    if (from === to) return;
    const { access_token } = (await token.json()) as { access_token: string };
    await fetch(`${API}/api/v1/settings/profile`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${access_token}` },
      body: JSON.stringify({ password: to, currentPassword: from }),
    });
    return;
  }
  throw new Error(`Could not restore ${TEAMMATE}'s password: neither password signs in.`);
}

test.describe("Password change ends every session", () => {
  test.afterEach(async () => {
    await restorePassword();
  });

  test("the other browser and this one land on the sign-in form", async ({ browser }) => {
    const a = await openSignedIn(browser, "/settings/profile");
    const b = await openSignedIn(browser, "/drive");
    const pageA = a.pages()[0]!;
    const pageB = b.pages()[0]!;
    try {
      await pageA.getByRole("button", { name: "Change" }).last().click();
      const dialog = pageA.getByRole("dialog", { name: "Change password" });
      await dialog.getByLabel("Current password").fill(ORIGINAL);
      await dialog.getByLabel("New password").fill(CHANGED);
      const saved = pageA.waitForResponse(
        (res) => res.url().includes("/settings/profile") && res.request().method() === "PUT",
      );
      await dialog.getByRole("button", { name: "Change password" }).click();
      expect((await saved).ok()).toBe(true);

      // A: the next app it opens shows the sign-in form, not an error page.
      await pageA.goto("/drive");
      await expect(pageA.locator("#password")).toBeVisible({ timeout: 30_000 });
      await expect(pageA.getByText(/failed|error/i)).toHaveCount(0);

      // B: any reload shows the sign-in form too.
      await pageB.reload();
      await expect(pageB.locator("#password")).toBeVisible({ timeout: 30_000 });
      await expect(pageB.getByText(/failed|error/i)).toHaveCount(0);

      // The new password works.
      await signIn(pageB, CHANGED);
      await expect(pageB.locator("#password")).toHaveCount(0, { timeout: 30_000 });
      await expect(pageB).not.toHaveURL(/\/login/, { timeout: 30_000 });
    } finally {
      await a.close();
      await b.close();
    }
  });
});
