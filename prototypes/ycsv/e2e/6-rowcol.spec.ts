import { expect, test, type Page } from "@playwright/test";
import { cell, clickCell, MOD, nameBox, open, rows } from "./helpers";

async function columnWidths(page: Page) {
  return page.evaluate(() => window.__sheet!.doc.getArray("columns").toArray().map((c) => (c as { get(k: string): unknown }).get("width")));
}

async function headerOrder(page: Page) {
  return page.locator('[role="columnheader"] > span:first-child').allInnerTexts();
}

async function dragHeader(page: Page, from: string, toX: number, toY: number) {
  const box = (await page.locator(from).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(toX, toY, { steps: 8 });
  await expect(page.getByTestId("drop-indicator")).toBeVisible();
  await page.mouse.up();
}

test.describe("6 · rows and columns", () => {
  test.beforeEach(async ({ page }) => open(page));

  test("resize a column by dragging; double-click fits it to the content", async ({ page }) => {
    const handle = (await page.getByTestId("resize-2").boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + 10);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 + 64, handle.y + 10, { steps: 5 });
    await page.mouse.up();
    expect((await columnWidths(page))[2]).toBe(184);
    expect(Math.round((await page.getByTestId("colhead-2").boundingBox())!.width)).toBe(184);
    await page.getByTestId("resize-5").dblclick();
    const fitted = (await columnWidths(page))[5] as number;
    expect(fitted).toBeLessThan(120);
    expect(fitted).toBeGreaterThan(48);
    // The width lives in the doc, so it is in the .ycsv file too.
    expect(await page.evaluate(() => window.__sheet!.serialize())).toContain("width: 184");
  });

  test("context menu: insert a row above keeps ranges that span it", async ({ page }) => {
    await cell(page, 2, 0).click({ button: "right" });
    await expect(page.getByRole("menu", { name: "Cell actions" })).toBeVisible();
    await page.getByRole("menuitem", { name: "Insert 1 row above" }).click();
    const grid = await rows(page);
    expect(grid).toHaveLength(7);
    expect(grid[2]?.[0]).toBe("");
    // SUM(aantal1:aantal4) still spans Appels..Wijn, now rows 1..5.
    expect(grid[5]?.[1]).toBe("=SUM(aantal1:aantal5)");
    expect(await nameBox(page)).toBe("product3:notitie3");
  });

  test("delete a column: formulas that used it show #REF!", async ({ page }) => {
    await page.getByTestId("colhead-2").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Delete 1 column" }).click();
    expect(await headerOrder(page)).toEqual(["Product", "Aantal", "Totaal", "Datum", "Notitie"]);
    await expect(cell(page, 0, 2)).toHaveText("#REF!");
    expect((await rows(page))[0]?.[2]).toBe("=aantal*#REF!*(1+btw)");
    await page.keyboard.press(`${MOD}+z`);
    expect(await headerOrder(page)).toEqual(["Product", "Aantal", "Prijs", "Totaal", "Datum", "Notitie"]);
    await expect(cell(page, 0, 3)).toHaveText("€ 3,27");
  });

  test("move a column by dragging its selected header", async ({ page }) => {
    await page.getByTestId("colhead-0").click();
    const target = (await page.getByTestId("colhead-2").boundingBox())!;
    await dragHeader(page, '[data-testid="colhead-0"]', target.x + target.width - 4, target.y + target.height / 2);
    expect(await headerOrder(page)).toEqual(["Aantal", "Prijs", "Product", "Totaal", "Datum", "Notitie"]);
    expect(await nameBox(page)).toBe("product1:product6");
    // Same-row formulas still compute.
    await expect(cell(page, 0, 3)).toHaveText("€ 3,27");
  });

  test("move a row by dragging its selected header; row ids keep formulas pointing at it", async ({ page }) => {
    const rh = page.locator('[role="rowheader"]');
    await rh.nth(3).click();
    const to = (await rh.nth(0).boundingBox())!;
    await dragHeader(page, '[role="rowheader"] >> nth=3', to.x + to.width / 2, to.y + 3);
    const grid = await rows(page);
    expect(grid.map((r) => r[0])).toEqual(["Wijn", "Appels", "Brood", "Kaas", "Totaal", "Fout"]);
    // The SUM range ends are row ids: Appels..Wijn. Wijn is now row 1 and Appels row 2,
    // so the range covers rows 1..2 only. Excel and Sheets do the same when an end
    // cell moves (references follow the cell). Finding for the doc.
    expect(grid[4]?.[1]).toBe("=SUM(aantal2:aantal1)");
    await expect(cell(page, 4, 1)).toHaveText("9");
  });

  test("freeze rows from the menu; frozen rows stay while scrolling", async ({ page }) => {
    await page.goto("/iframe.html?id=spike-6-cell-ux--frozen-header-row&viewMode=story");
    await expect(page.getByTestId("grid")).toBeVisible();
    await page.getByTestId("grid").evaluate((el) => (el.scrollTop = 3000));
    await expect(cell(page, 0, 1)).toBeVisible();
    await expect(cell(page, 0, 1)).toHaveText("Item 1");
    await clickCell(page, 0, 1);
    expect(await nameBox(page)).toBe("naam1");
    await page.keyboard.press("ArrowDown");
    // Moving into the body scrolls it back to row 2.
    await expect(cell(page, 1, 1)).toBeInViewport();
    await cell(page, 1, 1).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Freeze up to row 2" }).click();
    expect(await page.evaluate(() => window.__sheet!.doc.getMap("meta").get("frozen_rows"))).toBe(2);
  });

  test("keyboard: Shift+F10 opens the menu, arrows move, Escape returns focus; Cmd/Ctrl+Alt+= inserts", async ({ page }) => {
    await clickCell(page, 1, 1);
    await page.keyboard.press("Shift+F10");
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /^Cut/ })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menuitem", { name: /^Copy/ })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(page.getByTestId("cell-input")).toBeFocused();
    await page.keyboard.press(`${MOD}+Alt+Equal`);
    expect(await rows(page)).toHaveLength(7);
    expect((await rows(page))[1]?.[0]).toBe("");
  });
});
