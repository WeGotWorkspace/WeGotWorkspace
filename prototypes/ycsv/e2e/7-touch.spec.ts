import { expect, test, type CDPSession, type Page } from "@playwright/test";
import { center, nameBox, rows } from "./helpers";

async function openTouch(page: Page, story = "grid") {
  await page.goto(`/iframe.html?id=spike-6-cell-ux--${story}&viewMode=story`);
  await expect(page.getByTestId("grid")).toBeVisible();
  await page.waitForFunction(() => !!window.__sheet);
}

async function touch(cdp: CDPSession, type: "touchStart" | "touchMove" | "touchEnd", x: number, y: number) {
  await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
}

async function tapCell(page: Page, r: number, c: number) {
  const { x, y } = await center(page, r, c);
  await page.touchscreen.tap(x, y);
}

test.describe("7 · touch (Pixel 7 emulation)", () => {
  test("tap selects without opening the keyboard; double-tap edits", async ({ page }) => {
    await openTouch(page);
    await tapCell(page, 1, 0);
    expect(await nameBox(page)).toBe("product2");
    await expect(page.getByTestId("cell-input")).toHaveAttribute("inputmode", "none");
    // Rows are taller for fingers.
    const box = (await center(page, 1, 0)).box;
    expect(Math.round(box.height)).toBe(36);
    await page.waitForTimeout(500);
    await tapCell(page, 1, 0);
    await tapCell(page, 1, 0);
    await expect(page.getByTestId("edit-mode")).toHaveText("Edit");
    await expect(page.getByTestId("cell-input")).toHaveValue("Brood");
    await expect(page.getByTestId("cell-input")).toHaveAttribute("inputmode", "text");
    await page.keyboard.type("je");
    await page.keyboard.press("Enter");
    expect((await rows(page))[1]?.[0]).toBe("Broodje");
  });

  test("long-press opens the context menu", async ({ page }) => {
    await openTouch(page);
    const cdp = await page.context().newCDPSession(page);
    const { x, y } = await center(page, 2, 1);
    await touch(cdp, "touchStart", x, y);
    await page.waitForTimeout(700);
    await touch(cdp, "touchEnd", x, y);
    await expect(page.getByRole("menu")).toBeVisible();
    expect(await nameBox(page)).toBe("aantal3");
  });

  test("a swipe scrolls and does not change the selection", async ({ page }) => {
    await openTouch(page, "ten-thousand-rows");
    await tapCell(page, 0, 0);
    const cdp = await page.context().newCDPSession(page);
    const { x, y } = await center(page, 8, 1);
    await touch(cdp, "touchStart", x, y);
    for (let i = 1; i <= 10; i += 1) await touch(cdp, "touchMove", x, y - i * 30);
    await touch(cdp, "touchEnd", x, y - 300);
    await expect.poll(() => page.getByTestId("grid").evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
    expect(await nameBox(page)).toBe("id1");
  });

  test("the fill handle can be dragged with a finger", async ({ page }) => {
    await openTouch(page);
    // Column 1: on a phone the later columns are off screen.
    await tapCell(page, 0, 1);
    const handle = (await page.getByTestId("fill-handle").boundingBox())!;
    const to = await center(page, 3, 1);
    const cdp = await page.context().newCDPSession(page);
    await touch(cdp, "touchStart", handle.x + handle.width / 2, handle.y + handle.height / 2);
    for (let i = 1; i <= 6; i += 1) await touch(cdp, "touchMove", to.x, handle.y + ((to.y - handle.y) * i) / 6);
    await touch(cdp, "touchEnd", to.x, to.y);
    expect((await rows(page)).slice(0, 4).map((r) => r[1])).toEqual(["6", "6", "6", "6"]);
  });
});
