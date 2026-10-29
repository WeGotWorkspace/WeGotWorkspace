// Docs collab: a member loses read access to a shared Doc while editing.
// The collaboration save answers 404 (final "gone" state), so the editor offers
// "Keep local copy" and a reload still shows the local text.
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import {
  docsUrlForFile,
  expectPendingDotHidden,
  myDriveDocSearchPath,
  seedDocAtPath,
} from "./helpers/docs-live";

const API = process.env.WGW_E2E_API_URL ?? "http://127.0.0.1:9080";
const APP = process.env.WGW_APPS_E2E_BASE_URL ?? "http://127.0.0.1:5173";
const PASSWORD = process.env.WGW_E2E_PASSWORD ?? "storybook-dev";

test.use({ storageState: { cookies: [], origins: [] } });

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
      await editor.pressSequentially("carol first", { delay: 20 });
      await expectPendingDotHidden(member.page);

      const revoked = await owner.page.request.delete(`${API}/api/v1/files/shares/${shareId}`, {
        headers,
      });
      expect(revoked.ok(), await revoked.text()).toBeTruthy();

      await editor.click();
      await editor.press("End");
      await editor.pressSequentially(" carol second", { delay: 20 });

      await expect(
        member.page.getByRole("heading", { name: "This document is no longer available" }),
      ).toBeVisible({
        timeout: 45_000,
      });
      await member.page.getByRole("button", { name: "Keep local copy" }).click();
      await expect(editor).toContainText("carol second");

      await member.page.reload();
      await expect(member.page.locator(".ProseMirror")).toContainText("carol second", {
        timeout: 30_000,
      });
    } finally {
      await owner.context.close();
      await member.context.close();
    }
  });
});
