import { expect, test, type Page } from "@playwright/test";
import { center, nameBox, rows } from "./helpers";
import { boxOf, doubleTap, drag, fakeKeyboard, fling, holdDrag, holdThenPinch, isChromium, longPress, openTouch, phone, pinch, tap, tapCell } from "./touch-helpers";

/**
 * Spike 7 — touch. Runs in four projects: Android phone + tablet (Chromium,
 * real touch through CDP) and iPhone + iPad (WebKit, taps real, drags synthetic).
 */

const rowHeader = (page: Page, n: number) => page.locator('[role="rowheader"]').filter({ hasText: new RegExp(`^${n}$`) });

async function settle(page: Page) {
  let last = -1;
  await expect
    .poll(async () => {
      const now = await page.getByTestId("grid").evaluate((el) => el.scrollTop);
      const same = now === last;
      last = now;
      return same;
    }, { intervals: [150] })
    .toBe(true);
}

async function waitTapWindow(page: Page) {
  // Let the double-tap window (350 ms) pass so the next tap is a new tap.
  await page.waitForTimeout(400);
}

test.describe("8 · touch — shared by both variants", () => {
  test("tap selects without the keyboard; a header tap selects, a second tap opens its actions", async ({ page }) => {
    await openTouch(page);
    await tapCell(page, 1, 0);
    expect(await nameBox(page)).toBe("product2");
    await expect(page.getByTestId("cell-input")).toHaveAttribute("inputmode", "none");
    expect(Math.round((await center(page, 1, 0)).box.height)).toBe(36);

    await tap(page, await boxOf(page, "colhead-1"));
    expect(await nameBox(page)).toBe("aantal1:aantal6");
    await expect(page.getByTestId("colhead-1")).toHaveClass(/is-whole/);
    await waitTapWindow(page);
    await tap(page, await boxOf(page, "colhead-1"));
    await expect(page.getByRole("menu", { name: "Column actions" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Move column right" })).toBeVisible();
    const item = await page.getByRole("menuitem", { name: "Move column right" }).boundingBox();
    expect(item!.height).toBeGreaterThanOrEqual(44);
  });

  test("double-tap edits: docked above the keyboard on a phone, in the cell on a tablet", async ({ page }) => {
    await openTouch(page);
    await tapCell(page, 1, 0);
    await waitTapWindow(page);
    await doubleTap(page, await center(page, 1, 0));
    if (phone(page)) {
      await expect(page.getByTestId("dock")).toHaveAttribute("data-docked", "true");
      await expect(page.getByTestId("formula-bar")).toBeFocused();
      await expect(page.getByTestId("formula-bar")).toHaveValue("Brood");
      await page.keyboard.type("je");
      await tap(page, await boxOf(page, "dock-commit"));
      await expect(page.getByTestId("dock")).not.toHaveAttribute("data-docked", "true");
    } else {
      await expect(page.getByTestId("cell-input")).toBeFocused();
      await expect(page.getByTestId("cell-input")).toHaveAttribute("inputmode", "text");
      await expect(page.getByTestId("cell-input")).toHaveValue("Brood");
      await page.keyboard.type("je");
      await page.keyboard.press("Enter");
    }
    expect((await rows(page))[1]?.[0]).toBe("Broodje");
    // Back in navigation the keyboard is told to go away.
    await expect(page.getByTestId("cell-input")).toHaveAttribute("inputmode", "none");
  });

  test("long-press opens a finger-sized menu; copy and paste work through it", async ({ page }) => {
    await openTouch(page);
    await longPress(page, await center(page, 0, 1));
    await expect(page.getByRole("menu")).toBeVisible();
    expect(await nameBox(page)).toBe("aantal1");
    expect((await page.getByRole("menuitem", { name: "Copy" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.getByRole("menuitem", { name: "Copy" }).tap();
    await expect(page.getByRole("menu")).toBeHidden();
    await expect(page.getByTestId("copy-ants")).toBeVisible();
    await longPress(page, await center(page, 2, 1));
    await page.getByRole("menuitem", { name: "Paste", exact: true }).tap();
    // Chromium reads the system clipboard; WebKit without permission falls back to the in-sheet copy.
    await expect.poll(async () => (await rows(page))[2]?.[1]).toBe("6");
  });

  test("row actions on touch: move a row down from the header menu", async ({ page }) => {
    await openTouch(page);
    await tap(page, await rowHeader(page, 2).boundingBox().then((b) => ({ x: b!.x + b!.width / 2, y: b!.y + b!.height / 2 })));
    expect(await nameBox(page)).toBe("product2:notitie2");
    await longPress(page, await rowHeader(page, 2).boundingBox().then((b) => ({ x: b!.x + b!.width / 2, y: b!.y + b!.height / 2 })));
    await page.getByRole("menuitem", { name: "Move row down" }).tap();
    const r = await rows(page);
    expect([r[1]?.[0], r[2]?.[0]]).toEqual(["Kaas", "Brood"]);
    expect(await nameBox(page)).toBe("product3:notitie3");
  });

  test("frozen rows stay on top while the body scrolls", async ({ page }) => {
    await openTouch(page, "frozen-a");
    const before = (await center(page, 0, 1)).box.y;
    await page.getByTestId("grid").evaluate((el) => (el.scrollTop = 3000));
    await expect.poll(() => page.getByTestId("body").getAttribute("data-rows")).not.toMatch(/^1-/);
    expect((await center(page, 0, 1)).box.y).toBe(before);
    if (isChromium(page)) {
      await fling(page, { x: 200, y: 400 }, -1500);
      await expect.poll(() => page.getByTestId("grid").evaluate((el) => el.scrollTop)).toBeGreaterThan(3500);
      expect((await center(page, 0, 1)).box.y).toBe(before);
    }
  });

  test("the edited cell stays above the keyboard", async ({ page }) => {
    await openTouch(page, "frozen-a");
    // A row near the bottom of the screen.
    const grid = (await page.getByTestId("grid").boundingBox())!;
    const lowRow = await page.evaluate(
      ({ bottom }) => {
        const cells = [...document.querySelectorAll('[role="gridcell"][id$="-1"]')];
        const ok = cells.filter((c) => c.getBoundingClientRect().bottom < bottom - 4);
        const id = ok[ok.length - 1]?.id ?? "";
        return Number(id.split("-cell-")[1]?.split("-")[0]);
      },
      { bottom: grid.y + grid.height },
    );
    await tapCell(page, lowRow, 1);
    await waitTapWindow(page);
    await doubleTap(page, await center(page, lowRow, 1));
    const kb = Math.round((page.viewportSize()!.height * 0.42));
    await fakeKeyboard(page, kb);
    const visibleBottom = page.viewportSize()!.height - kb;
    if (phone(page)) {
      await expect(page.getByTestId("dock")).toHaveAttribute("data-docked", "true");
      await expect.poll(async () => {
        const d = (await page.getByTestId("dock").boundingBox())!;
        return Math.round(d.y + d.height);
      }).toBe(visibleBottom);
      const dock = (await page.getByTestId("dock").boundingBox())!;
      await expect.poll(async () => (await center(page, lowRow, 1)).box.y + (await center(page, lowRow, 1)).box.height).toBeLessThanOrEqual(dock.y);
    } else {
      await expect.poll(async () => {
        const b = (await page.getByTestId("editor-wrap").boundingBox())!;
        return b.y + b.height;
      }).toBeLessThanOrEqual(visibleBottom);
    }
  });

  test("formula autocomplete, symbol strip and tap-to-reference on touch", async ({ page }) => {
    await openTouch(page);
    // prijs5 is empty and on screen on a phone too.
    await tapCell(page, 4, 2);
    await waitTapWindow(page);
    await doubleTap(page, await center(page, 4, 2));
    if (phone(page)) {
      const bar = page.getByTestId("formula-bar");
      await expect(bar).toBeFocused();
      await tap(page, await boxOf(page, "key-="));
      await expect(bar).toBeFocused();
      await page.keyboard.type("SU");
      const ac = page.getByTestId("autocomplete");
      await expect(ac).toHaveAttribute("data-placement", "dock");
      // On a phone the suggestions are chips inside the dock: nothing covers the grid.
      await expect(page.getByTestId("dock").getByTestId("autocomplete")).toBeVisible();
      expect((await page.getByRole("option", { name: /SUM/ }).first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await page.locator('[role="option"]', { has: page.locator(".sx-option-label", { hasText: /^SUM$/ }) }).tap();
      await expect(bar).toHaveValue("=SUM(");
      await expect(page.getByTestId("signature")).toContainText("SUM(");
      // Tap a cell to insert a reference; the edit stays open.
      await tapCell(page, 0, 1);
      await expect(bar).toHaveValue("=SUM(aantal1");
      await tap(page, await boxOf(page, "key-)"));
      await expect(bar).toHaveValue("=SUM(aantal1)");
      await tap(page, await boxOf(page, "dock-commit"));
    } else {
      const input = page.getByTestId("cell-input");
      await page.keyboard.type("=SU");
      await expect(page.getByTestId("autocomplete")).toHaveAttribute("data-placement", "below");
      // With the keyboard up there is no room under the cell: the list flips above it.
      await fakeKeyboard(page, page.viewportSize()!.height - (await center(page, 4, 2)).box.y - 120);
      await expect(page.getByTestId("autocomplete")).toHaveAttribute("data-placement", "above");
      await page.locator('[role="option"]', { has: page.locator(".sx-option-label", { hasText: /^SUM$/ }) }).tap();
      await expect(input).toHaveValue("=SUM(");
      await tapCell(page, 0, 1);
      await expect(input).toHaveValue("=SUM(aantal1");
      await page.keyboard.type(")");
      await page.keyboard.press("Enter");
    }
    expect((await rows(page))[4]?.[2]).toBe("=SUM(aantal1)");
  });
});

test.describe("8 · touch — variant A", () => {
  test("no range handles; the fill handle is finger-sized and drags", async ({ page }) => {
    await openTouch(page, "variant-a");
    await tapCell(page, 0, 1);
    await expect(page.getByTestId("handle-end")).toHaveCount(0);
    const h = await boxOf(page, "fill-handle");
    expect(h.box.width).toBeGreaterThanOrEqual(14);
    await drag(page, h, await center(page, 3, 1));
    expect((await rows(page)).slice(0, 4).map((r) => r[1])).toEqual(["6", "6", "6", "6"]);
  });

  test("a finger resting on the bottom edge keeps the fill going (edge auto-scroll)", async ({ page }) => {
    await openTouch(page, "frozen-a");
    await tapCell(page, 2, 1);
    const h = await boxOf(page, "fill-handle");
    const grid = (await page.getByTestId("grid").boundingBox())!;
    await drag(page, h, { x: h.x, y: grid.y + grid.height - 6 }, { hold: 900 });
    expect(await page.getByTestId("grid").evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
    const label = await nameBox(page);
    const end = Number(label.split(":")[1]?.replace(/\D/g, ""));
    expect(end).toBeGreaterThan(25);
    expect((await rows(page))[end - 1]?.[1]).toBe(`Item ${end}`);
  });
});

test.describe("8 · touch — variant B", () => {
  test("range handles replace the fill handle; dragging them selects a range", async ({ page }) => {
    await openTouch(page, "variant-b");
    await tapCell(page, 0, 1);
    await expect(page.getByTestId("fill-handle")).toHaveCount(0);
    await expect(page.getByTestId("handle-start")).toBeVisible();
    await drag(page, await boxOf(page, "handle-end"), await center(page, 3, 2));
    expect(await nameBox(page)).toBe("aantal1:prijs4");
    await expect(page.getByTestId("callout")).toBeVisible();
    // The start handle moves the other corner.
    await drag(page, await boxOf(page, "handle-start"), await center(page, 1, 1));
    expect(await nameBox(page)).toBe("aantal2:prijs4");
    await expect(page.getByTestId("status")).toContainText("Count 6");
    // A tap elsewhere drops the range and the callout.
    await tapCell(page, 0, 0);
    await expect(page.getByTestId("callout")).toHaveCount(0);
    expect(await nameBox(page)).toBe("product1");
  });

  test("Fill from the callout turns the end handle into a fill handle", async ({ page }) => {
    await openTouch(page, "variant-b");
    await tapCell(page, 0, 1);
    await drag(page, await boxOf(page, "handle-end"), await center(page, 0, 1));
    await tap(page, await boxOf(page, "callout-fill"));
    await expect(page.getByTestId("handle-end")).toHaveCount(0);
    await drag(page, await boxOf(page, "fill-handle"), await center(page, 3, 1));
    expect((await rows(page)).slice(0, 4).map((r) => r[1])).toEqual(["6", "6", "6", "6"]);
    await expect(page.getByTestId("handle-end")).toBeVisible();
  });

  test("whole rows get their handles on the row headers", async ({ page }) => {
    await openTouch(page, "variant-b");
    const rh = (await rowHeader(page, 2).boundingBox())!;
    await tap(page, { x: rh.x + rh.width / 2, y: rh.y + rh.height / 2 });
    expect(await nameBox(page)).toBe("product2:notitie2");
    const end = await boxOf(page, "handle-end");
    expect(end.x).toBeLessThan(rh.x + rh.width);
    await drag(page, end, { x: end.x, y: (await center(page, 3, 0)).y });
    expect(await nameBox(page)).toBe("product2:notitie4");
  });
});

test.describe("8 · touch — variant C (hold-to-drag)", () => {
  test("hold, then drag selects a range; the B handles and callout take over after the lift", async ({ page }) => {
    await openTouch(page, "variant-c");
    await holdDrag(page, await center(page, 1, 0), await center(page, 2, 1));
    expect(await nameBox(page)).toBe("product2:aantal3");
    await expect(page.getByTestId("armed")).toHaveCount(0);
    await expect(page.getByTestId("callout")).toBeVisible();
    await expect(page.getByTestId("handle-end")).toBeVisible();
    await drag(page, await boxOf(page, "handle-end"), await center(page, 3, 1));
    expect(await nameBox(page)).toBe("product2:aantal4");
  });

  test("a hold that does not move is still a tap, and double-tap still edits", async ({ page }) => {
    await openTouch(page, "variant-c");
    // 260 ms rest arms the drag; lifting without moving selects like a tap.
    await holdDrag(page, await center(page, 2, 0), await center(page, 2, 0), { hold: 260, steps: 0 });
    expect(await nameBox(page)).toBe("product3");
    await expect(page.getByTestId("armed")).toHaveCount(0);
    await expect(page.getByRole("menu")).toHaveCount(0);
    await page.waitForTimeout(400);
    await doubleTap(page, await center(page, 1, 0));
    if (phone(page)) await expect(page.getByTestId("formula-bar")).toBeFocused();
    else await expect(page.getByTestId("cell-input")).toBeFocused();
  });

  test("holding still opens the menu after the drag would have armed", async ({ page }) => {
    await openTouch(page, "variant-c");
    await longPress(page, await center(page, 1, 1));
    await expect(page.getByRole("menu", { name: "Cell actions" })).toBeVisible();
    await expect(page.getByTestId("armed")).toHaveCount(0);
    expect(await nameBox(page)).toBe("aantal2");
  });

  test("hold, then drag a column header moves the column", async ({ page }) => {
    await openTouch(page, "variant-c");
    const before = (await rows(page))[0]!;
    const from = await boxOf(page, "colhead-0");
    const to = await boxOf(page, "colhead-2");
    await holdDrag(page, from, { x: to.box.x + to.box.width - 6, y: to.y });
    const after = (await rows(page))[0]!;
    expect(after.slice(0, 3)).toEqual([before[1], before[2], before[0]]);
    expect(await nameBox(page)).toMatch(/^product1:product\d+$/);
  });

  test("hold, then drag a row header moves the row", async ({ page }) => {
    await openTouch(page, "variant-c");
    const before = await rows(page);
    // Row 2, not row 1: the start handle of the default A1 selection overlaps row header 1.
    const rh = (await rowHeader(page, 2).boundingBox())!;
    const target = (await rowHeader(page, 4).boundingBox())!;
    await holdDrag(page, { x: rh.x + rh.width / 2, y: rh.y + rh.height / 2 }, { x: rh.x + rh.width / 2, y: target.y + target.height - 4 });
    const after = await rows(page);
    expect(after.slice(0, 4)).toEqual([before[0], before[2], before[3], before[1]]);
  });

  test("hold, then drag a column header edge resizes the column", async ({ page }) => {
    await openTouch(page, "variant-c");
    const h = await boxOf(page, "colhead-1");
    const edge = { x: h.box.x + h.box.width - 4, y: h.y };
    await holdDrag(page, edge, { x: edge.x + 60, y: edge.y });
    const w = (await boxOf(page, "colhead-1")).box.width;
    expect(Math.round(w - h.box.width)).toBeGreaterThanOrEqual(50);
  });
});

test.describe("8 · touch — Chromium-only gestures (real touch input)", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "needs CDP touch input");

  test("a swipe pans the grid and leaves the selection alone, in both variants", async ({ page }) => {
    for (const story of ["variant-a", "variant-b"]) {
      await openTouch(page, story === "variant-a" ? "frozen-a" : "frozen-b");
      await tapCell(page, 3, 1);
      const from = await center(page, 8, 1);
      await drag(page, from, { x: from.x, y: from.y - 300 }, { steps: 10 });
      await expect.poll(() => page.getByTestId("grid").evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
      expect(await nameBox(page)).toBe("naam4");
    }
  });

  test("variant C: a quick swipe still pans (no hold), and only a rested finger selects", async ({ page }) => {
    await openTouch(page, "frozen-c");
    await tapCell(page, 3, 1);
    const from = await center(page, 8, 1);
    await holdDrag(page, from, { x: from.x, y: from.y - 300 }, { hold: 0, steps: 10, stepMs: 8 });
    await expect.poll(() => page.getByTestId("grid").evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
    expect(await nameBox(page)).toBe("naam4");
    // Let the momentum stop first: a finger that lands on a moving list catches the fling, it does not arm.
    await settle(page);
    const top = await page.getByTestId("grid").evaluate((el) => el.scrollTop);
    // Middle of the grid, away from the edge auto-scroll bands.
    const g = (await page.getByTestId("grid").boundingBox())!;
    const a = { x: (await center(page, 8, 1)).x, y: g.y + g.height / 2 - 40 };
    await holdDrag(page, a, { x: a.x, y: a.y + 2 * 36 }, { hold: 260 });
    expect(await page.getByTestId("grid").evaluate((el) => el.scrollTop)).toBe(top);
    expect(await nameBox(page)).toMatch(/^[a-z]+\d+:[a-z]+\d+$/);
  });

  test("variant C: a second finger after a hold pinches, it does not select", async ({ page }) => {
    await openTouch(page, "frozen-c");
    await page.evaluate(() => localStorage.removeItem("ycsv-grid-zoom"));
    await tapCell(page, 3, 1);
    const g = (await page.getByTestId("grid").boundingBox())!;
    await holdThenPinch(page, { x: g.x + g.width / 2, y: g.y + g.height / 2 }, 260, 100, 180);
    expect(Number(await page.getByTestId("body").getAttribute("data-row-h"))).toBeGreaterThan(55);
    expect(await nameBox(page)).toBe("naam4");
    await expect(page.getByTestId("armed")).toHaveCount(0);
    expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
    await page.evaluate(() => localStorage.removeItem("ycsv-grid-zoom"));
  });

  test("pinch zooms the grid, not the page, around the fingers", async ({ page }) => {
    await openTouch(page, "frozen-a");
    await page.evaluate(() => localStorage.removeItem("ycsv-grid-zoom"));
    const g = (await page.getByTestId("grid").boundingBox())!;
    const c = { x: g.x + g.width / 2, y: g.y + g.height / 2 };
    await pinch(page, c, 100, 180);
    const rowH = Number(await page.getByTestId("body").getAttribute("data-row-h"));
    expect(rowH).toBeGreaterThan(55);
    expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
    await pinch(page, c, 200, 80);
    expect(Number(await page.getByTestId("body").getAttribute("data-row-h"))).toBeLessThan(rowH);
    // Zoom is per person and device.
    expect(Number(await page.evaluate(() => localStorage.getItem("ycsv-grid-zoom")))).toBeGreaterThan(0);
    await page.evaluate(() => localStorage.removeItem("ycsv-grid-zoom"));
  });
});
