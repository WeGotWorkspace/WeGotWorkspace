import { expect, test } from "@playwright/test";

/** Offline Calendar day story — timed “Design review” on 2033-01-12. */
const CALENDAR_DAY_STORY = "apps-calendar--day";

test.describe("Calendar touch resize (Storybook)", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test("short-press opens details and shows end handles only on that event", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto(`/iframe.html?id=${CALENDAR_DAY_STORY}&viewMode=story`);

    const closeMenu = page.getByRole("button", { name: "Close menu" });
    if (await closeMenu.isVisible()) {
      await closeMenu.click();
    }

    const card = page.getByRole("button", { name: /Lunch\?/i }).first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("resize-handle[active]")).toHaveCount(0);

    const geometry = (el: Element) => {
      const wrap = (el.closest(".event") ?? el) as HTMLElement;
      const cell = (wrap.closest(".cell-main") ?? wrap.offsetParent) as HTMLElement | null;
      const wrapRect = wrap.getBoundingClientRect();
      const cellRect = cell?.getBoundingClientRect();
      return {
        topPct: cellRect && cellRect.height ? (wrapRect.top - cellRect.top) / cellRect.height : 0,
        height: wrapRect.height,
        start: wrap.style.getPropertyValue("--__start").trim(),
        end: wrap.style.getPropertyValue("--__end").trim(),
      };
    };

    const boxBefore = await card.evaluate(geometry);

    await card.click({ force: true });

    await expect(page.getByRole("heading", { name: /Lunch\?/i })).toBeVisible();
    await expect(page.locator("resize-handle[active]")).toHaveCount(2);
    await expect(page.locator("resize-handle[active]").first()).toBeVisible();

    const selected = page.locator(".event:has(resize-handle[active])").first();
    const boxAfter = await selected.evaluate(geometry);
    expect(boxAfter.start).toBe(boxBefore.start);
    expect(boxAfter.end).toBe(boxBefore.end);
    expect(Math.abs(boxAfter.topPct - boxBefore.topPct)).toBeLessThan(0.01);
    expect(Math.abs(boxAfter.height - boxBefore.height)).toBeLessThan(2);
  });
});
