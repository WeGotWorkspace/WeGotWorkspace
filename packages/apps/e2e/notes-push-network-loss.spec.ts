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

  test("second tab follows the first offline and back online without a focus event", async ({
    browser,
  }) => {
    const token = `e2e-push-loss-2tabs-${Date.now()}`;
    const context = await browser.newContext({ storageState: "e2e/.auth/admin.json" });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
    });
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    try {
      await prepareNotesForOfflineSync(pageA);
      await prepareNotesForOfflineSync(pageB);
      await openFirstNote(pageA);
      await openFirstNote(pageB);

      // Only the leader tab opens the event source.
      await context.waitForEvent("response", {
        predicate: (response) =>
          new URL(response.url()).pathname.includes("/jmap/events/") && response.status() === 200,
        timeout: 30_000,
      });
      await expect(pageA.locator('[data-connectivity="online"]').first()).toBeVisible();
      await expect(pageB.locator('[data-connectivity="online"]').first()).toBeVisible();

      await context.route("**/*", (route) => {
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

      await expect(pageA.locator('[data-connectivity="offline"]').first()).toBeVisible({
        timeout: 20_000,
      });
      await expect(pageB.locator('[data-connectivity="offline"]').first()).toBeVisible({
        timeout: 20_000,
      });

      await appendToActiveNoteBody(pageB, token);
      await expectPendingDotVisible(pageB);

      await context.unroute("**/*");
      await expect(pageA.locator('[data-connectivity="online"]').first()).toBeVisible({
        timeout: 90_000,
      });
      await expect(pageB.locator('[data-connectivity="online"]').first()).toBeVisible({
        timeout: 90_000,
      });
      await expectSyncCompleted(pageB);
      await expect.poll(() => noteTokenOnServer(pageB, token), { timeout: 45_000 }).toBe(true);
    } finally {
      await context.close();
    }
  });
});
