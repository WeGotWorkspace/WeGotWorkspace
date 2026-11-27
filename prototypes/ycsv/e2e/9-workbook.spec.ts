import { expect, test, type Page } from "@playwright/test";
import { clickCell, expectCellText, MOD } from "./helpers";

/**
 * Integration slice: a two-sheet workbook (spike 9 layout with a sheets root), cross-sheet
 * formulas on spike 4's incremental engine — in a Web Worker and on the main thread — and
 * one undo stack per person across tabs (spike 5 undo, spike 9 guard).
 */
const tab = (page: Page, i: number) => page.getByTestId("sheet-tab").nth(i);

async function type(page: Page, r: number, c: number, text: string) {
  await clickCell(page, r, c);
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}

for (const story of ["workbook", "workbook-main-thread"]) {
  test.describe(`9 · workbook (${story})`, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(`/iframe.html?id=spike-6-cell-ux--${story}&viewMode=story`);
      await expect(page.getByTestId("grid")).toBeVisible();
      await page.waitForFunction(() => !!window.__sheet);
    });

    test("tabs, cross-sheet refs and ranges, values follow edits on the other sheet", async ({ page }) => {
      await expect(page.getByTestId("sheet-tab")).toHaveCount(2);
      await expect(tab(page, 0)).toHaveAttribute("aria-selected", "true");
      await expectCellText(page, 0, 4, "Fruit");
      await expectCellText(page, 2, 4, "6");

      await tab(page, 1).click();
      await expect(tab(page, 1)).toHaveAttribute("aria-selected", "true");
      await type(page, 0, 1, "Appel");
      await type(page, 2, 2, "10");
      await tab(page, 0).click();
      await expectCellText(page, 0, 4, "Appel");
      await expectCellText(page, 2, 4, "13");
      // The file keeps the sheet ref; the doc keeps the sheet id.
      const text = await page.evaluate(() => window.__sheet!.serialize());
      expect(text).toContain("=categorieën!label1");
      expect(text).toContain("=SUM(categorieën!aantal1:categorieën!aantal3)");
    });

    test("undo of a step on another tab switches to that tab", async ({ page }) => {
      await tab(page, 1).click();
      await type(page, 2, 2, "10");
      await tab(page, 0).click();
      await expectCellText(page, 2, 4, "13");
      await clickCell(page, 1, 0);
      await page.keyboard.press(`${MOD}+z`);
      await expect(tab(page, 1)).toHaveAttribute("aria-selected", "true");
      await expectCellText(page, 2, 2, "3");
      await tab(page, 0).click();
      await expectCellText(page, 2, 4, "6");
    });

    test("add a sheet; a ref to a deleted sheet reads #REF!", async ({ page }) => {
      await page.getByTestId("add-sheet").click();
      await expect(page.getByTestId("sheet-tab")).toHaveCount(3);
      await expect(tab(page, 2)).toHaveAttribute("aria-selected", "true");
      await type(page, 0, 0, "41");
      await tab(page, 0).click();
      await type(page, 2, 0, "=sheet3!a1+1");
      await expectCellText(page, 2, 0, "42");
      await page.evaluate(() => window.__sheet!.deleteSheet(window.__sheet!.sheetIds()[2]!));
      await expect(page.getByTestId("sheet-tab")).toHaveCount(2);
      await expectCellText(page, 2, 0, "#REF!");
      expect((await page.evaluate(() => window.__sheet!.cells()))[2]?.[0]).toBe("=#REF!+1");
    });
  });
}

test.describe("9 · an open editor while a peer changes rows (spike 5's EditBase case)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/iframe.html?id=spike-6-cell-ux--a-11-y-two-users&viewMode=story`);
    await page.waitForFunction(() => !!window.__sheetB);
  });
  const left = (page: Page, r: number, c: number) => page.getByTestId("grid").first().locator(`[role="gridcell"][id$="-cell-${r}-${c}"]`);

  test("a peer inserts a row above while I type a formula: Enter writes my row, refs follow", async ({ page }) => {
    // Column 2 (prijs): the left grid's far columns sit under the right grid in this story.
    const box = (await left(page, 2, 2).boundingBox())!; // Kaas, prijs
    await page.mouse.click(box.x + 20, box.y + 10);
    await page.keyboard.type("=aantal3*2");
    await page.evaluate(() => window.__sheetB!.insertRows(1, 1)); // Ben, above Brood
    await expect.poll(async () => (await page.evaluate(() => window.__sheet!.cells()))[3]?.[0]).toBe("Kaas");
    await page.keyboard.press("Enter");
    const rows = await page.evaluate(() => window.__sheet!.cells());
    expect(rows[3]?.[0]).toBe("Kaas");
    expect(rows[3]?.[2]).toBe("=aantal4*2");
    expect(rows[2]?.[2]).toBe("2.99"); // Brood, now at Kaas's old index, untouched
    expect(rows[1]?.[2] ?? "").toBe("");
    await expect.poll(async () => (await page.evaluate(() => window.__sheetB!.cells()))[3]?.[2]).toBe("=aantal4*2");
  });

  test("a peer deletes the row I am editing: the edit is dropped, nothing is written elsewhere", async ({ page }) => {
    const box = (await left(page, 2, 2).boundingBox())!;
    await page.mouse.click(box.x + 20, box.y + 10);
    await page.keyboard.type("hallo");
    await expect(page.getByTestId("cell-input").first()).toHaveValue("hallo");
    const before = await page.evaluate(() => window.__sheet!.serialize());
    await page.evaluate(() => {
      const h = window.__sheetB!;
      // Ben deletes Kaas (row 3) through the same op the grid uses.
      h.setCell(2, 0, "weg");
    });
    await page.evaluate(async () => {
      const h = window.__sheetB!;
      h.deleteRow(2);
    });
    await page.keyboard.press("Enter");
    const after = await page.evaluate(() => window.__sheet!.serialize());
    expect(after).not.toContain("hallo");
    expect(before).toContain("Kaas");
    expect(after).not.toContain("weg");
  });
});
