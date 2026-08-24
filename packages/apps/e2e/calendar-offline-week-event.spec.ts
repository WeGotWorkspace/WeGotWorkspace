import { expect, test } from "@playwright/test";
import {
  CALENDAR_WEEK_DATE,
  countEventCardsByTitle,
  deleteOpenEvent,
  dragCreateOnWeekGrid,
  createOfflineWeekEvent,
  dumpEventCardHitTarget,
  eventCardByTitle,
  expectCalendarOffline,
  expectCalendarOnline,
  openCalendarWeek,
  resizeEventCardEnd,
  sampleEventCardHeights,
  sampleEventCardYs,
  saveNewEventDialog,
  scrollTimedGridToHour,
} from "./helpers/calendar-live";

test.describe("Calendar offline week event (live app)", () => {
  test("offline-created week card is selectable and draggable", async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const title = `e2e-off-week-${Date.now()}`;

    await openCalendarWeek(page, CALENDAR_WEEK_DATE);
    await page.context().setOffline(true);
    await expectCalendarOffline(page);

    await dragCreateOnWeekGrid(page);
    const dialog = page.getByRole("dialog", { name: "New event" });
    if (!(await dialog.isVisible().catch(() => false))) {
      await page.getByRole("button", { name: "New event" }).click();
    }
    await saveNewEventDialog(page, title);
    await expect(page.getByText("Event created")).toBeVisible({ timeout: 10_000 });

    await expect
      .poll(
        async () => {
          const next = await dumpEventCardHitTarget(page, title);
          return next.cards.some((card) => card.summary.includes(title) && Boolean(card.eventId));
        },
        { timeout: 15_000 },
      )
      .toBe(true);

    const dump = await dumpEventCardHitTarget(page, title);
    await testInfo.attach("event-card-hit-dump", {
      body: JSON.stringify(dump, null, 2),
      contentType: "application/json",
    });
    // Always print so a red run shows the overlay / pointer-events cause.
    console.log("event-card-hit-dump", JSON.stringify(dump, null, 2));

    const card = await eventCardByTitle(page, title);
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeVisible();

    expect(dump.counts.inert, `inert cards left after persist: ${JSON.stringify(dump)}`).toBe(0);
    expect(
      dump.counts.createPreview,
      `create-preview cards left after persist: ${JSON.stringify(dump)}`,
    ).toBe(0);
    expect(dump.counts.withEventId).toBeGreaterThan(0);
    expect(dump.cards.some((entry) => entry.eventId && entry.pointerEvents === "auto")).toBe(true);

    await card.click();
    const details = page.getByRole("dialog", { name: title });
    await expect(details).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    await expect(details).toBeHidden();

    await scrollTimedGridToHour(page, 10);
    const boxBefore = await card.boundingBox();
    expect(boxBefore).toBeTruthy();
    const startX = boxBefore!.x + boxBefore!.width / 2;
    const startY = boxBefore!.y + Math.min(10, boxBefore!.height / 2);
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX, startY + 90, { steps: 10 });
    await expect
      .poll(async () => {
        const live = await card.boundingBox();
        return live ? Math.abs(live.y - boxBefore!.y) : 0;
      })
      .toBeGreaterThan(20);
    await page.mouse.up();

    const ys = await sampleEventCardYs(page, title);
    expect(ys.length, "card left the DOM after offline dragend").toBeGreaterThan(0);
    const dropped = ys[ys.length - 1] ?? boxBefore!.y;
    expect(Math.abs(dropped - boxBefore!.y), "card did not stay on the drop slot").toBeGreaterThan(
      20,
    );
    const snappedBack = ys.some((y) => Math.abs(y - boxBefore!.y) < 12);
    expect(snappedBack, `offline dragend snapped back to the pre-drag slot: ${ys.join(",")}`).toBe(
      false,
    );
  });

  test("offline create stays in the DOM through reconnect", async ({ page }) => {
    test.setTimeout(90_000);
    const title = `e2e-off-reconnect-${Date.now()}`;

    await openCalendarWeek(page, CALENDAR_WEEK_DATE);
    await page.context().setOffline(true);
    await expectCalendarOffline(page);

    await createOfflineWeekEvent(page, title);
    await expect
      .poll(() => countEventCardsByTitle(page, title), { timeout: 15_000 })
      .toBeGreaterThan(0);

    await page.context().setOffline(false);
    await expectCalendarOnline(page);
    await expect
      .poll(() => countEventCardsByTitle(page, title), { timeout: 20_000 })
      .toBeGreaterThan(0);
    const card = await eventCardByTitle(page, title);
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeVisible();
  });

  test("offline delete stays gone and sibling create stays visible on reconnect", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const keepTitle = `e2e-off-keep-${Date.now()}`;
    const dropTitle = `e2e-off-drop-${Date.now()}`;

    await openCalendarWeek(page, CALENDAR_WEEK_DATE);
    await page.context().setOffline(true);
    await expectCalendarOffline(page);

    await createOfflineWeekEvent(page, keepTitle);
    await createOfflineWeekEvent(page, dropTitle);
    await expect
      .poll(() => countEventCardsByTitle(page, dropTitle), { timeout: 15_000 })
      .toBeGreaterThan(0);

    const dropCard = await eventCardByTitle(page, dropTitle);
    await dropCard.click();
    await expect(page.getByRole("dialog", { name: dropTitle })).toBeVisible({ timeout: 10_000 });
    await deleteOpenEvent(page);
    await expect.poll(() => countEventCardsByTitle(page, dropTitle), { timeout: 10_000 }).toBe(0);
    await expect
      .poll(() => countEventCardsByTitle(page, keepTitle), { timeout: 10_000 })
      .toBeGreaterThan(0);

    await page.context().setOffline(false);
    await expectCalendarOnline(page);
    await expect
      .poll(() => countEventCardsByTitle(page, keepTitle), { timeout: 20_000 })
      .toBeGreaterThan(0);
    await expect.poll(() => countEventCardsByTitle(page, dropTitle), { timeout: 20_000 }).toBe(0);
  });

  test("offline week resize keeps the new duration (does not snap back)", async ({ page }) => {
    test.setTimeout(90_000);
    const title = `e2e-off-resize-${Date.now()}`;

    await openCalendarWeek(page, CALENDAR_WEEK_DATE);
    await page.context().setOffline(true);
    await expectCalendarOffline(page);

    await createOfflineWeekEvent(page, title, 20);
    await expect
      .poll(
        async () => {
          const dump = await dumpEventCardHitTarget(page, title);
          return dump.cards.some(
            (entry) => entry.summary.includes(title) && Boolean(entry.eventId),
          );
        },
        { timeout: 15_000 },
      )
      .toBe(true);
    await scrollTimedGridToHour(page, 20);
    const card = await eventCardByTitle(page, title);
    await card.scrollIntoViewIfNeeded();
    const boxBefore = await card.boundingBox();
    expect(boxBefore).toBeTruthy();

    await resizeEventCardEnd(page, title, 96);
    const heights = await sampleEventCardHeights(page, title);
    expect(heights.length, "card left the DOM after offline resize").toBeGreaterThan(0);
    const grew = heights.some((height) => height - boxBefore!.height > 20);
    expect(grew, `offline resize did not grow the card: ${heights.join(",")}`).toBe(true);
    const last = heights[heights.length - 1] ?? boxBefore!.height;
    expect(
      last - boxBefore!.height,
      "offline resize snapped back to the original duration",
    ).toBeGreaterThan(20);
  });

  test("online week resize keeps the new duration (does not snap back)", async ({ page }) => {
    test.setTimeout(90_000);
    const title = `e2e-on-resize-${Date.now()}`;

    await openCalendarWeek(page, CALENDAR_WEEK_DATE);
    await expectCalendarOnline(page);

    await createOfflineWeekEvent(page, title, 20);
    await expect
      .poll(
        async () => {
          const dump = await dumpEventCardHitTarget(page, title);
          return dump.cards.some(
            (entry) => entry.summary.includes(title) && Boolean(entry.eventId),
          );
        },
        { timeout: 15_000 },
      )
      .toBe(true);
    // Let the create persist/bootstrap refresh settle so it does not remount mid-drag.
    await page.waitForTimeout(1500);
    await scrollTimedGridToHour(page, 20);
    const card = await eventCardByTitle(page, title);
    await card.scrollIntoViewIfNeeded();
    const boxBefore = await card.boundingBox();
    expect(boxBefore).toBeTruthy();

    await resizeEventCardEnd(page, title, 96);
    const heights = await sampleEventCardHeights(page, title);
    expect(heights.length, "card left the DOM after online resize").toBeGreaterThan(0);
    const grew = heights.some((height) => height - boxBefore!.height > 20);
    expect(grew, `online resize did not grow the card: ${heights.join(",")}`).toBe(true);
    const last = heights[heights.length - 1] ?? boxBefore!.height;
    expect(
      last - boxBefore!.height,
      "online resize snapped back to the original duration",
    ).toBeGreaterThan(20);
  });
});
