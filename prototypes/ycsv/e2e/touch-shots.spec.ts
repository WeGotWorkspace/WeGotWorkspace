import { mkdirSync } from "node:fs";
import { test, type Page } from "@playwright/test";
import { center } from "./helpers";
import { boxOf, doubleTap, drag, fakeKeyboard, isChromium, longPress, openTouch, phone, pinch, tap, tapCell } from "./touch-helpers";

/**
 * Spike 7 screenshots → docs/spike-7-touch/<project>-<name>.png
 *   SHOTS=1 SB_PORT=6027 pnpm exec playwright test e2e/touch-shots.spec.ts --project=iphone --project=ipad --project=android-phone
 * The on-screen keyboard is simulated (a grey block + a shrunken visualViewport).
 */
test.skip(!process.env.SHOTS, "set SHOTS=1");
const DIR = "docs/spike-7-touch";
mkdirSync(DIR, { recursive: true });

async function shot(page: Page, name: string) {
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${DIR}/${test.info().project.name}-${name}.png` });
}

async function keyboard(page: Page) {
  const h = Math.round(page.viewportSize()!.height * (phone(page) ? 0.4 : 0.33));
  await fakeKeyboard(page, h);
  await page.evaluate((h) => {
    const kb = document.createElement("div");
    kb.textContent = "on-screen keyboard (simulated)";
    Object.assign(kb.style, { position: "fixed", left: "0", right: "0", bottom: "0", height: `${h}px`, background: "#d1d5db", color: "#52525b", font: "13px system-ui", display: "flex", alignItems: "center", justifyContent: "center", zIndex: "200" });
    document.body.appendChild(kb);
  }, h);
  if (phone(page))
    await page.waitForFunction((h) => {
      const d = document.querySelector('[data-testid="dock"]')?.getBoundingClientRect();
      return !!d && Math.round(d.bottom) === window.innerHeight - h;
    }, h);
}

test("A: tap, fill handle, long-press menu", async ({ page }) => {
  await openTouch(page, "variant-a");
  await tapCell(page, 1, 1);
  await shot(page, "a-tap");
  await longPress(page, await center(page, 2, 1));
  await shot(page, "a-long-press-menu");
});

test("A: fill handle drag", async ({ page }) => {
  await openTouch(page, "variant-a");
  await tapCell(page, 0, 1);
  await drag(page, await boxOf(page, "fill-handle"), await center(page, 3, 1));
  await shot(page, "a-after-fill");
});

test("B: range handles and callout", async ({ page }) => {
  await openTouch(page, "variant-b");
  await tapCell(page, 1, 1);
  await shot(page, "b-tap");
  await drag(page, await boxOf(page, "handle-end"), await center(page, 3, 2));
  await shot(page, "b-range-callout");
  await tap(page, await boxOf(page, "callout-fill"));
  await shot(page, "b-fill-mode");
});

test("B: whole row and column handles", async ({ page }) => {
  await openTouch(page, "variant-b");
  await tap(page, await boxOf(page, "colhead-1"));
  await shot(page, "b-column");
  const rh = (await page.locator('[role="rowheader"]').filter({ hasText: /^3$/ }).boundingBox())!;
  await tap(page, { x: rh.x + rh.width / 2, y: rh.y + rh.height / 2 });
  await drag(page, await boxOf(page, "handle-end"), { x: rh.x + rh.width / 2, y: (await center(page, 4, 0)).y });
  await shot(page, "b-rows");
});

test("editing with the keyboard up: autocomplete and symbols", async ({ page }) => {
  await openTouch(page, "variant-a");
  await tapCell(page, 4, 2);
  await page.waitForTimeout(400);
  await doubleTap(page, await center(page, 4, 2));
  await keyboard(page);
  if (phone(page)) {
    await tap(page, await boxOf(page, "key-="));
    await page.keyboard.type("SU");
  } else await page.keyboard.type("=SU");
  await shot(page, "edit-autocomplete");
  await page.locator('[role="option"]', { has: page.locator(".sx-option-label", { hasText: /^SUM$/ }) }).tap();
  // A row that is still visible above the keyboard.
  await tapCell(page, 3, 1);
  await shot(page, "edit-pick-ref");
});

test("frozen row while scrolled", async ({ page }) => {
  await openTouch(page, "frozen-b");
  await page.getByTestId("grid").evaluate((el) => (el.scrollTop = 2400));
  await tapCell(page, 72, 1);
  await shot(page, "frozen-scrolled");
});

test("pinch zoom out", async ({ page }) => {
  test.skip(!isChromium(page), "pinch input needs CDP");
  await openTouch(page, "frozen-a");
  const g = (await page.getByTestId("grid").boundingBox())!;
  await pinch(page, { x: g.x + g.width / 2, y: g.y + g.height / 2 }, 240, 140);
  await shot(page, "pinch-zoomed-out");
  await page.evaluate(() => localStorage.removeItem("ycsv-grid-zoom"));
});

test("dark B", async ({ page }) => {
  await openTouch(page, "variant-b-dark");
  await tapCell(page, 1, 1);
  await drag(page, await boxOf(page, "handle-end"), await center(page, 3, 2));
  await shot(page, "b-dark");
});
