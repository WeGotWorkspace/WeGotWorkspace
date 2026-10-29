// Notes offline e2e (live app and API).
//
// - A note body saves with PUT /notes/items/{uid} (collab room = VJOURNAL UID);
//   y-indexeddb is a UID-keyed crash buffer. Fields (archive, tags) use PATCH + If-Match.
// - List pending = metadata outbox OR unsaved/collab-pending body.
import { expect, test } from "./helpers/live-test";
import {
  appendToActiveNoteBody,
  archiveNoteTokenOnServer,
  seedNoteWithToken,
  deleteFilteredArchivedNotes,
  expectOfflineIndicator,
  expectPendingDotHidden,
  expectPendingDotVisible,
  expectSyncCompleted,
  noteTokenOnServer,
  openArchiveView,
  openFirstNote,
  prepareNotesForOfflineSync,
  restoreNetwork,
  waitForNoteSaved,
  blockReachabilityAndApi,
  reloadNotesOffline,
} from "./helpers/notes-live";

test.describe("Notes offline sync (live app)", () => {
  // Each case signs in, wipes the offline store and reloads first; the CI runner needs more than 90s.
  test.describe.configure({ timeout: 180_000 });

  test("network offline: edit, reconnect, pending dot clears and sync toast shows", async ({
    page,
  }) => {
    const token = `e2e-net-${Date.now()}`;

    await prepareNotesForOfflineSync(page);
    await openFirstNote(page);

    await page.context().setOffline(true);
    await expectOfflineIndicator(page);

    await appendToActiveNoteBody(page, token);
    await expectPendingDotVisible(page);

    await page.context().setOffline(false);
    await expectSyncCompleted(page);
    await expect(page.locator(".ProseMirror")).toContainText(token);
  });

  test("offline edit of a note you leave: background save clears its pending dot", async ({
    page,
  }) => {
    const token = `e2e-left-${Date.now()}`;

    await prepareNotesForOfflineSync(page);
    await openFirstNote(page);

    await page.context().setOffline(true);
    await expectOfflineIndicator(page);
    await appendToActiveNoteBody(page, token);

    // Leave the note: its editor unmounts and the body waits for a background save.
    await page.locator(".list-item__button").nth(1).click();
    await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 15_000 });
    await expectPendingDotVisible(page);

    await page.context().setOffline(false);
    await expect.poll(() => noteTokenOnServer(page, token), { timeout: 45_000 }).toBe(true);
    await expectPendingDotHidden(page);
  });

  test("offline create + body edit reconnect preserves body", async ({ page }) => {
    const token = `e2e-create-offline-${Date.now()}`;

    await prepareNotesForOfflineSync(page);

    await page.context().setOffline(true);
    await expectOfflineIndicator(page);
    await page.getByRole("button", { name: "New note" }).click();
    await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 20_000 });
    await appendToActiveNoteBody(page, token);
    await expectPendingDotVisible(page);

    await page.context().setOffline(false);
    await expectSyncCompleted(page);
    await waitForNoteSaved(page, token);
    await expect(page.locator(".ProseMirror")).toContainText(token);
  });

  test("stale navigator.onLine: blocked API/probe then restore triggers sync", async ({ page }) => {
    const token = `e2e-stale-${Date.now()}`;

    await prepareNotesForOfflineSync(page);
    await blockReachabilityAndApi(page);
    await reloadNotesOffline(page);
    await expectOfflineIndicator(page);

    await openFirstNote(page);
    await appendToActiveNoteBody(page, token);
    await expectPendingDotVisible(page);

    await restoreNetwork(page);
    await expectSyncCompleted(page);
    await expect(page.locator(".ProseMirror")).toContainText(token);
  });

  test("two windows: editor syncs and observer sees edit without reload", async ({ browser }) => {
    const token = `e2e-2win-${Date.now()}`;
    const authFile = "e2e/.auth/admin.json";
    // Same browser context so BroadcastChannel / IDB match real multi-tab behavior.
    const context = await browser.newContext({ storageState: authFile });
    const editor = await context.newPage();
    const observer = await context.newPage();

    try {
      await prepareNotesForOfflineSync(editor);
      await prepareNotesForOfflineSync(observer);
      await openFirstNote(editor);
      await openFirstNote(observer);

      await editor.context().setOffline(true);
      await expectOfflineIndicator(editor);

      await appendToActiveNoteBody(editor, token);
      await expectPendingDotVisible(editor);
      // Tabs in one browser context share the edit locally right away, so the
      // observer may already show it; the server checks below prove the sync.

      // A note body saves with PUT /api/v1/notes/items/{uid} (room = note UID).
      const serverSync = editor.waitForResponse(
        (response) =>
          /\/api\/v1\/notes\/items\/[^/?]+$/.test(new URL(response.url()).pathname) &&
          response.request().method() === "PUT" &&
          response.ok(),
        { timeout: 30_000 },
      );
      await editor.context().setOffline(false);
      await expectSyncCompleted(editor);
      await serverSync;

      await expect.poll(() => noteTokenOnServer(editor, token), { timeout: 20_000 }).toBe(true);

      await expect
        .poll(
          async () =>
            observer.evaluate(
              (expected) => document.body.textContent?.includes(expected) ?? false,
              token,
            ),
          { timeout: 30_000 },
        )
        .toBe(true);
    } finally {
      await context.close();
    }
  });

  test("online delete: permanent delete syncs to server", async ({ page }) => {
    const token = `e2e-del-${Date.now()}`;

    await prepareNotesForOfflineSync(page);
    await seedNoteWithToken(page, token);
    await archiveNoteTokenOnServer(page, token);
    await deleteFilteredArchivedNotes(page, token);

    await expect.poll(() => noteTokenOnServer(page, token), { timeout: 20_000 }).toBe(false);
    await expect(page.getByText(token)).toHaveCount(0);
  });

  test("offline delete: queues delete and syncs after reconnect", async ({ page }) => {
    const token = `e2e-del-off-${Date.now()}`;

    await prepareNotesForOfflineSync(page);
    await seedNoteWithToken(page, token);
    await archiveNoteTokenOnServer(page, token);
    await openArchiveView(page, token);

    await page.context().setOffline(true);
    await expectOfflineIndicator(page);

    await page.getByRole("button", { name: "Empty archive" }).click();
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText(token)).toHaveCount(0);

    await page.context().setOffline(false);
    await expectSyncCompleted(page);

    await expect.poll(() => noteTokenOnServer(page, token), { timeout: 45_000 }).toBe(false);
  });
});
