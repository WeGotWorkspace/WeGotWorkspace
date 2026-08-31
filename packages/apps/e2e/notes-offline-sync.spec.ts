// Notes offline e2e (live, cross-service — NOT run in this chunk).
//
// Contract after VJOURNAL + Dexie inbound (#671):
// - Note BODY edits persist via PATCH /notes/items/{uid} + If-Match
//   (collab room = VJOURNAL UID). y-indexeddb is a UID-keyed crash buffer.
//   There is no PUT /files/collaboration for notes.
// - List pending = metadata outbox OR unsaved/collab-pending body.
//
// Remaining live-validation TODOs flagged for the next e2e pass (need a running
// stack to confirm the collab pending-dot/toast wiring and group fixtures):
//   1. Confirm `expectPendingDotVisible` / `expectSyncCompleted` resolve against
//      the collab pending-sync indicator for body-only edits (the helpers may
//      need a collab-specific selector vs. the metadata dot).
//   2. Add a shared-notebook scenario (group principal / CalendarShareInvites):
//      two members edit the same shared note body over the mesh + reconnect.
import { expect, test } from "@playwright/test";
import {
  appendToActiveNoteBody,
  archiveNoteTokenOnServer,
  seedNoteWithToken,
  deleteFilteredArchivedNotes,
  expectOfflineIndicator,
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
      await expect(observer.getByText(token)).toHaveCount(0);

      // Dual-path contract: a note **body** edit now persists through the Docs
      // collab document (`PUT /api/v1/files/collaboration`, room = note path),
      // NOT through `/notes/items` (which is metadata-only). The body still
      // surfaces on `/notes/items` reads because collab merges into the same
      // `.md` file, but the write that must land is the collaboration PUT.
      const serverSync = editor.waitForResponse(
        (response) =>
          response.url().includes("/api/v1/files/collaboration") &&
          response.request().method() !== "GET" &&
          response.ok(),
        { timeout: 30_000 },
      );
      await editor.context().setOffline(false);
      await expectSyncCompleted(editor);
      await serverSync;

      await expect
        .poll(
          async () =>
            editor.evaluate(async (expected) => {
              const accessToken = localStorage.getItem("wgw.api.access_token");
              const response = await fetch("/api/v1/notes/items", {
                headers: { Authorization: `Bearer ${accessToken}` },
              });
              if (!response.ok) return false;
              const json = (await response.json()) as { items?: { body?: string }[] };
              return json.items?.some((item) => item.body?.includes(expected)) ?? false;
            }, token),
          { timeout: 20_000 },
        )
        .toBe(true);

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
