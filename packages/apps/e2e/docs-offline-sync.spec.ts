import { expect, test } from "./helpers/live-test";
import {
  appendToActiveDocBody,
  blockReachabilityAndApi,
  clearDocsOfflineStore,
  currentEditorText,
  docTokenOnServer,
  E2E_GROUP_ROOT,
  docsHomeRow,
  docsUrlForFile,
  expectEditorContains,
  expectOfflineIndicator,
  expectPendingDotVisible,
  expectSyncCompleted,
  gotoDocsHome,
  loginToDocs,
  myDriveDocSearchPath,
  prepareDocsForOfflineSync,
  prepareGroupDocForOfflineSync,
  reloadDocsOffline,
  restoreNetwork,
  seedDocAtPath,
  waitForDocsBodySynced,
  waitForDocSaved,
} from "./helpers/docs-live";

test.describe("Docs offline sync (live app)", () => {
  test("My Drive .md: offline edit reconnects and persists to server", async ({ page }) => {
    const token = `e2e-md-mydrive-${Date.now()}`;
    const fileName = `e2e-md-mydrive-${Date.now()}.md`;
    const apiPath = await prepareDocsForOfflineSync(page, fileName);

    await page.context().setOffline(true);
    await expectOfflineIndicator(page);

    await appendToActiveDocBody(page, token);
    await expectPendingDotVisible(page);

    await page.context().setOffline(false);
    await expectSyncCompleted(page);
    await waitForDocSaved(page, apiPath, token);

    await page.goto(docsUrlForFile(apiPath));
    await expect(page.locator(".ProseMirror")).toContainText(token);
  });

  test("Group/shared .md: offline edit shows pending dot and syncs", async ({ page }) => {
    const token = `e2e-md-group-${Date.now()}`;
    const apiPath = `${E2E_GROUP_ROOT}/e2e-shared-${Date.now()}.md`;

    await prepareGroupDocForOfflineSync(page, apiPath);

    await page.context().setOffline(true);
    await expectOfflineIndicator(page);

    await appendToActiveDocBody(page, token);
    await expectPendingDotVisible(page);

    await page.context().setOffline(false);
    await expectSyncCompleted(page);
    await waitForDocSaved(page, apiPath, token);

    await page.goto(docsUrlForFile(apiPath));
    await expect(page.locator(".ProseMirror")).toContainText(token);
  });

  test("multi-tab same user: reconnect sync appears in other tab", async ({ browser }) => {
    const token = `e2e-tab-${Date.now()}`;
    const fileName = `e2e-tab-${Date.now()}.md`;
    const authFile = "e2e/.auth/admin.json";
    const context = await browser.newContext({ storageState: authFile });
    const tabA = await context.newPage();
    const tabB = await context.newPage();

    try {
      const apiPath = await prepareDocsForOfflineSync(tabA, fileName);
      await tabB.goto(docsUrlForFile(apiPath));
      await expect(tabB.locator(".ProseMirror")).toBeVisible({ timeout: 30_000 });

      await context.setOffline(true);
      await expectOfflineIndicator(tabA);
      await expectOfflineIndicator(tabB);

      await appendToActiveDocBody(tabA, token);
      await expectPendingDotVisible(tabA);
      expect(await currentEditorText(tabB)).not.toContain(token);

      await context.setOffline(false);
      await expectSyncCompleted(tabA);
      await expectEditorContains(tabB, token);
    } finally {
      await context.close();
    }
  });

  test("two contexts: offline user reconnect merges with online edits", async ({ browser }) => {
    const onlineToken = `e2e-ctx-online-${Date.now()}`;
    const offlineToken = `e2e-ctx-offline-${Date.now()}`;
    const apiPath = `${E2E_GROUP_ROOT}/e2e-merge-${Date.now()}.md`;
    const authFile = "e2e/.auth/admin.json";
    const contextA = await browser.newContext({ storageState: authFile });
    const contextB = await browser.newContext({ storageState: authFile });
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      await loginToDocs(pageA);
      await pageA.goto(docsUrlForFile(apiPath));
      await pageB.goto(docsUrlForFile(apiPath));
      await expect(pageA.locator(".ProseMirror")).toBeVisible({ timeout: 30_000 });
      await expect(pageB.locator(".ProseMirror")).toBeVisible({ timeout: 30_000 });

      await contextB.setOffline(true);
      await expectOfflineIndicator(pageB);

      await appendToActiveDocBody(pageA, onlineToken);
      await waitForDocSaved(pageA, apiPath, onlineToken);

      await appendToActiveDocBody(pageB, offlineToken);
      await expectPendingDotVisible(pageB);

      await contextB.setOffline(false);
      await expectSyncCompleted(pageB);
      await waitForDocSaved(pageB, apiPath, offlineToken);

      await expectEditorContains(pageA, onlineToken);
      await expectEditorContains(pageA, offlineToken);
      await expectEditorContains(pageB, onlineToken);
      await expectEditorContains(pageB, offlineToken);
      await expect
        .poll(() => docTokenOnServer(pageA, apiPath, onlineToken), { timeout: 30_000 })
        .toBe(true);
      await expect
        .poll(() => docTokenOnServer(pageA, apiPath, offlineToken), { timeout: 30_000 })
        .toBe(true);
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test("plain text file: offline edit reconnects and syncs", async ({ page }) => {
    const token = `e2e-text-${Date.now()}`;
    const fileName = `e2e-text-${Date.now()}.txt`;
    const apiPath = await prepareDocsForOfflineSync(page, fileName);

    await page.context().setOffline(true);
    await expectOfflineIndicator(page);

    await appendToActiveDocBody(page, token);
    await expectPendingDotVisible(page);

    await page.context().setOffline(false);
    await expectSyncCompleted(page);
    await waitForDocSaved(page, apiPath, token);
    await expect(page.locator(".ProseMirror")).toContainText(token);
  });

  test("My Drive auto-sync: never-opened doc opens offline, edits, reconnects", async ({
    page,
  }) => {
    const token = `e2e-auto-mydrive-${Date.now()}`;
    const fileName = `e2e-auto-mydrive-${Date.now()}.md`;
    const searchPath = myDriveDocSearchPath(fileName);
    const apiPath = `/${searchPath}`;

    await loginToDocs(page);
    await clearDocsOfflineStore(page);
    await seedDocAtPath(apiPath, "# Auto-sync seed\n");
    await gotoDocsHome(page);
    await waitForDocsBodySynced(page, fileName, apiPath);

    await page.context().setOffline(true);
    await docsHomeRow(page, fileName).dblclick();
    await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 30_000 });
    await expectOfflineIndicator(page);

    await appendToActiveDocBody(page, token);
    await expectPendingDotVisible(page);

    await page.context().setOffline(false);
    await expectSyncCompleted(page);
    await waitForDocSaved(page, apiPath, token);
  });

  test("Group auto-sync: never-opened doc opens offline, edits, reconnects", async ({ page }) => {
    const token = `e2e-auto-group-${Date.now()}`;
    const fileName = `e2e-auto-group-${Date.now()}.md`;
    const apiPath = `${E2E_GROUP_ROOT}/${fileName}`;

    await loginToDocs(page);
    await clearDocsOfflineStore(page);
    await seedDocAtPath(apiPath, "# Group auto-sync seed\n");
    await gotoDocsHome(page);
    await waitForDocsBodySynced(page, fileName, apiPath);

    await page.context().setOffline(true);
    await docsHomeRow(page, fileName).dblclick();
    await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 30_000 });
    await expectOfflineIndicator(page);

    await appendToActiveDocBody(page, token);
    await expectPendingDotVisible(page);

    await page.context().setOffline(false);
    await expectSyncCompleted(page);
    await waitForDocSaved(page, apiPath, token);
  });

  test("My Drive .md: open doc caches offline, edit reconnect persists", async ({ page }) => {
    const token = `e2e-pin-home-${Date.now()}`;
    const fileName = `e2e-pin-home-${Date.now()}.md`;
    const apiPath = await prepareDocsForOfflineSync(page, fileName);

    await page.context().setOffline(true);
    await expectOfflineIndicator(page);

    await appendToActiveDocBody(page, token);
    await expectPendingDotVisible(page);

    await page.context().setOffline(false);
    await expectSyncCompleted(page);
    await waitForDocSaved(page, apiPath, token);
  });

  test("Group .md: open doc caches offline, edit reconnect persists", async ({ page }) => {
    const token = `e2e-pin-group-${Date.now()}`;
    const fileName = `e2e-pin-group-${Date.now()}.md`;
    const apiPath = `${E2E_GROUP_ROOT}/${fileName}`;

    await prepareGroupDocForOfflineSync(page, apiPath);

    await page.context().setOffline(true);
    await expectOfflineIndicator(page);

    await appendToActiveDocBody(page, token);
    await expectPendingDotVisible(page);

    await page.context().setOffline(false);
    await expectSyncCompleted(page);
    await waitForDocSaved(page, apiPath, token);
  });

  test("reconnect conflict: opens conflict dialog when re-merge cannot save", async ({ page }) => {
    const token = `e2e-conflict-${Date.now()}`;
    const fileName = `e2e-conflict-${Date.now()}.md`;
    const apiPath = await prepareDocsForOfflineSync(page, fileName);

    await page.context().setOffline(true);
    await expectOfflineIndicator(page);
    await appendToActiveDocBody(page, token);
    await expectPendingDotVisible(page);

    await page.route("**/api/v1/files/collaboration**", async (route) => {
      if (route.request().method() === "GET") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 412,
        contentType: "application/json",
        body: JSON.stringify({ error: "stateMismatch" }),
      });
    });
    await page.context().setOffline(false);

    await expect(page.getByRole("heading", { name: "Document conflict" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole("button", { name: "Keep mine" })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(encodeURIComponent(apiPath.replace(/^\/+/, ""))));
  });

  test("stale navigator.onLine: blocked API/probe then restore triggers sync", async ({ page }) => {
    const token = `e2e-stale-${Date.now()}`;
    const fileName = `e2e-stale-${Date.now()}.md`;

    const apiPath = await prepareDocsForOfflineSync(page, fileName);
    await blockReachabilityAndApi(page);
    await reloadDocsOffline(page, apiPath);
    await expectOfflineIndicator(page);

    await appendToActiveDocBody(page, token);
    await expectPendingDotVisible(page);

    await restoreNetwork(page);
    await expectSyncCompleted(page);
    await expect(page.locator(".ProseMirror")).toContainText(token);
  });
});
