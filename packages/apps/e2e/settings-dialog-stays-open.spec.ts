// A dialog opened right after Settings opens must stay open. Settings used to mount
// again when its first answer arrived, which closed the dialog and dropped what was typed.
// Cold browser: a fresh context with no session, signed in through the form.
import { expect, test } from "./helpers/live-test";
import { passwordFor, TEAMMATE } from "./helpers/live-matrix";

const APP = process.env.WGW_APPS_E2E_BASE_URL ?? "http://127.0.0.1:5173";

test.use({ storageState: { cookies: [], origins: [] } });

test("a dialog opened as soon as Settings shows is still open afterwards", async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: APP,
    storageState: { cookies: [], origins: [] },
  });
  // Count how often the Settings workspace is put on the page.
  await context.addInitScript(() => {
    const w = window as unknown as { __settingsMounts: number };
    w.__settingsMounts = 0;
    let last: Element | null = null;
    new MutationObserver(() => {
      const el = document.querySelector(".settings-workspace");
      if (el && el !== last) w.__settingsMounts += 1;
      last = el;
    }).observe(document, { childList: true, subtree: true });
  });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Username", { exact: true }).fill(TEAMMATE);
  await page.getByLabel("Password", { exact: true }).fill(passwordFor(TEAMMATE));
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);

  await page.goto("/settings/security");
  await page.getByRole("button", { name: "Create app password" }).click();
  const dialog = page.getByRole("dialog", { name: "New app password" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox").first().fill("Calendar on my phone");

  // Long enough for the settings answer and every follow-up render to land.
  await page.waitForTimeout(3_000);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox").first()).toHaveValue("Calendar on my phone");
  const mounts = await page.evaluate(
    () => (window as unknown as { __settingsMounts: number }).__settingsMounts,
  );
  expect(mounts).toBe(1);
  await context.close();
});
