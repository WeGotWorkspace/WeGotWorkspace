// Losing the network mid-session while navigator.onLine stays true (#2296):
// the push stream is the online check, so its failures take the tab offline and,
// once push is unhealthy, the reachability probe resumes by itself.
import { expect, test } from "./helpers/live-test";
import {
  appendToActiveNoteBody,
  expectPendingDotVisible,
  expectSyncCompleted,
  noteTokenOnServer,
  openFirstNote,
  prepareNotesForOfflineSync,
} from "./helpers/notes-live";

test.describe("Notes push as the online check (live app)", () => {
  test.describe.configure({ timeout: 180_000 });

  test("network lost with navigator.onLine true: offline, edit, back online without a focus event", async ({
    page,
  }) => {
    const token = `e2e-push-loss-${Date.now()}`;

    await page.addInitScript(() => {
      Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
    });
    await prepareNotesForOfflineSync(page);
    await openFirstNote(page);

    // Push is healthy once the event source answered.
    await page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.includes("/jmap/events/") && response.status() === 200,
      { timeout: 30_000 },
    );

    await page.route("**/*", (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (
        (request.method() === "HEAD" && url.pathname === "/") ||
        url.pathname.includes("/jmap/") ||
        url.pathname.includes("/api/v1/")
      ) {
        return route.abort("failed");
      }
      return route.continue();
    });

    await expect(page.locator('[data-connectivity="offline"]').first()).toBeVisible({
      timeout: 20_000,
    });
    await appendToActiveNoteBody(page, token);
    await expectPendingDotVisible(page);

    // No focus event: the probe resumes on its own once push is unhealthy.
    await page.unroute("**/*");
    await expect(page.locator('[data-connectivity="online"]').first()).toBeVisible({
      timeout: 90_000,
    });
    await expectSyncCompleted(page);
    await expect.poll(() => noteTokenOnServer(page, token), { timeout: 45_000 }).toBe(true);
  });
});
