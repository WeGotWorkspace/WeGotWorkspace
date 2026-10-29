// Docs collab: a member loses read access to a shared Doc while editing.
// The member sees one "no longer available" state (no "Access lost" toast),
// keeps the local copy, and sees the same state again after a reload.
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { docsUrlForFile, myDriveDocSearchPath, seedDocAtPath } from "./helpers/docs-live";

const API = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";
const APP = process.env.WGW_APPS_E2E_BASE_URL ?? "http://127.0.0.1:5173";
const PASSWORD = process.env.WGW_E2E_PASSWORD ?? "storybook-dev";

const GONE_HEADING = "This document is no longer available";
const ACCESS_LOST_TITLE = "Access lost";
const ACCESS_LOST_MESSAGE =
  "You no longer have access to this document. Your local copy is still on this device.";

test.use({ storageState: { cookies: [], origins: [] } });

async function expectGoneWithoutAccessLost(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: GONE_HEADING })).toBeVisible({
    timeout: 45_000,
  });
  // The room poll is refused within about a second; give its message time to show.
  await page.waitForTimeout(3_000);
  await expect(page.getByText(ACCESS_LOST_TITLE, { exact: true })).toHaveCount(0);
  await expect(page.getByText(ACCESS_LOST_MESSAGE)).toHaveCount(0);
}

async function openAs(
  browser: Browser,
  username: string,
): Promise<{ context: BrowserContext; page: Page; accessToken: string }> {
  const context = await browser.newContext({
    baseURL: APP,
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  const response = await page.request.post(`${API}/api/v1/auth/token`, {
    data: { username, password: PASSWORD },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const tokens = (await response.json()) as { access_token?: string };
  if (!tokens.access_token) throw new Error(`Login for ${username} did not return tokens.`);
  await context.addInitScript(
    ({ access }) => {
      localStorage.setItem("wgw.api.access_token", access);
      localStorage.setItem("wgw.api.session_kind", "member");
    },
    { access: tokens.access_token },
  );
  return { context, page, accessToken: tokens.access_token };
}

test.describe("Docs collab access revoked (live app)", () => {
  test.describe.configure({ timeout: 180_000 });

  test("a member who loses access while editing keeps the local copy, also after a reload", async ({
    browser,
  }) => {
    const fileName = `e2e-revoke-${Date.now()}.md`;
    const apiPath = `/${myDriveDocSearchPath(fileName)}`;
    const owner = await openAs(browser, "admin");
    const member = await openAs(browser, "member");

    try {
      await seedDocAtPath(apiPath, "# Revoke\n");
      const headers = { Authorization: `Bearer ${owner.accessToken}` };
      const created = await owner.page.request.post(`${API}/api/v1/files/shares`, {
        headers,
        data: {
          path: apiPath,
          kind: "member",
          defaultAccess: "view",
          shareWith: { member: { access: "edit" } },
        },
      });
      expect(created.ok(), await created.text()).toBeTruthy();
      const shareId = ((await created.json()) as { data: { id: string } }).data.id;

      await member.page.goto(docsUrlForFile(apiPath));
      const editor = member.page.locator(".ProseMirror");
      await expect(editor).toBeVisible({ timeout: 30_000 });
      await editor.click();
      await editor.press("End");
      await editor.pressSequentially("member first", { delay: 20 });
      // The first save must reach the server before the share is revoked.
      await expect
        .poll(
          async () => {
            const content = await owner.page.request.get(
              `${API}/api/v1/files/content?path=${encodeURIComponent(apiPath)}`,
              { headers },
            );
            return content.ok() && (await content.text()).includes("member first");
          },
          { timeout: 30_000 },
        )
        .toBe(true);

      const revoked = await owner.page.request.delete(`${API}/api/v1/files/shares/${shareId}`, {
        headers,
      });
      expect(revoked.ok(), await revoked.text()).toBeTruthy();

      await editor.click();
      await editor.press("End");
      await editor.pressSequentially(" member second", { delay: 20 });

      await expectGoneWithoutAccessLost(member.page);
      await member.page.getByRole("button", { name: "Keep local copy" }).click();
      await expect(editor).toContainText("member second");

      await member.page.reload();
      await expectGoneWithoutAccessLost(member.page);
      await expect(member.page.locator(".ProseMirror")).toContainText("member second", {
        timeout: 30_000,
      });
    } finally {
      await owner.context.close();
      await member.context.close();
    }
  });
});
