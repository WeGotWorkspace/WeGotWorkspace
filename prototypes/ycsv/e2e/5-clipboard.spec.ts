import { expect, test, type Page } from "@playwright/test";
import { cell, clickCell, MOD, nameBox, open, pasteData, rawAt, rows } from "./helpers";
import { EXCEL_HTML, EXCEL_TSV, NUMBERS_HTML, NUMBERS_TSV, SHEETS_HTML, SHEETS_TSV } from "./fixtures/clipboard";

async function typeAt(page: Page, r: number, c: number, text: string) {
  await clickCell(page, r, c);
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}

async function selectRange(page: Page, a: [number, number], b: [number, number]) {
  await clickCell(page, ...a);
  await clickCell(page, ...b, ["Shift"]);
}

/** What the real copy event put on the clipboard (read back through the async API). */
async function clipboardFlavours(page: Page) {
  return page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const out: Record<string, string> = {};
    for (const item of items) for (const type of item.types) out[type] = await (await item.getType(type)).text();
    return out;
  });
}

test.describe("5 · clipboard inside the sheet (real keyboard shortcuts, real clipboard)", () => {
  test("copy writes TSV + HTML table with our payload; paste shifts formulas", async ({ page }) => {
    await open(page, "empty");
    for (let r = 0; r < 3; r += 1) await typeAt(page, r, 0, String(r + 1));
    await typeAt(page, 0, 1, "=a1*2");
    await selectRange(page, [0, 0], [0, 1]);
    await page.keyboard.press(`${MOD}+c`);
    await expect(page.getByTestId("copy-ants")).toBeVisible();
    const flavours = await clipboardFlavours(page);
    expect(flavours["text/plain"]).toBe("1\t2");
    expect(flavours["text/html"]).toContain("<table data-ycsv=");
    await clickCell(page, 2, 2);
    await page.keyboard.press(`${MOD}+v`);
    expect(await rawAt(page, 2, 2)).toBe("1");
    expect(await rawAt(page, 2, 3)).toBe("=c3*2");
    expect(await nameBox(page)).toBe("c3:d3");
    // Copy keeps the marching ants (paste again is allowed); Escape clears them.
    await expect(page.getByTestId("copy-ants")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("copy-ants")).toBeHidden();
  });

  test("cut moves cells and keeps formulas as they were", async ({ page }) => {
    await open(page, "empty");
    await typeAt(page, 0, 0, "4");
    await typeAt(page, 0, 1, "=a1+1");
    await selectRange(page, [0, 0], [0, 1]);
    await page.keyboard.press(`${MOD}+x`);
    await clickCell(page, 3, 2);
    await page.keyboard.press(`${MOD}+v`);
    const grid = await rows(page);
    expect(grid[0]?.slice(0, 2)).toEqual(["", ""]);
    expect(grid[3]?.slice(2, 4)).toEqual(["4", "=a1+1"]);
    await expect(page.getByTestId("copy-ants")).toBeHidden();
    // One undo brings back both sides of the move.
    await page.keyboard.press(`${MOD}+z`);
    expect((await rows(page))[0]?.slice(0, 2)).toEqual(["4", "=a1+1"]);
  });

  test("a block tiles into a larger selection that is a multiple of it", async ({ page }) => {
    await open(page, "empty");
    await typeAt(page, 0, 0, "x");
    await typeAt(page, 1, 0, "y");
    await selectRange(page, [0, 0], [1, 0]);
    await page.keyboard.press(`${MOD}+c`);
    await selectRange(page, [0, 2], [5, 3]);
    await page.keyboard.press(`${MOD}+v`);
    const grid = await rows(page);
    expect(grid.slice(0, 6).map((row) => row.slice(2, 4).join(""))).toEqual(["xx", "yy", "xx", "yy", "xx", "yy"]);
  });

  test("paste values only (Shift+Cmd/Ctrl+V) drops formulas", async ({ page }) => {
    await open(page);
    await clickCell(page, 0, 3);
    await page.keyboard.press(`${MOD}+c`);
    await clickCell(page, 2, 5);
    await page.keyboard.press(`Shift+${MOD}+v`);
    // Chromium under Playwright sends no paste event for this chord; the grid then
    // reads the clipboard itself (async API), so the result arrives a tick later.
    await expect.poll(() => rawAt(page, 2, 5)).toBe("3.267");
  });

  test("whole rows: Cmd+V overwrites, the menu inserts copied rows", async ({ page }) => {
    await open(page);
    await page.locator('[role="rowheader"]').nth(0).click();
    await page.keyboard.press(`${MOD}+c`);
    await page.locator('[role="rowheader"]').nth(2).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Insert copied rows above" }).click();
    await expect.poll(async () => (await rows(page)).length).toBe(7);
    const grid = await rows(page);
    expect(grid[2]?.[0]).toBe("Appels");
    expect(grid[3]?.[0]).toBe("Kaas");
    // Same-row formulas stay valid on the new row.
    await expect(cell(page, 2, 3)).toHaveText("€ 3,27");
    // Plain paste over a selected row overwrites instead.
    await page.locator('[role="rowheader"]').nth(4).click();
    await page.keyboard.press(`${MOD}+v`);
    expect(await rows(page)).toHaveLength(7);
    expect((await rows(page))[4]?.[0]).toBe("Appels");
  });

  test("paste past the edge grows the sheet", async ({ page }) => {
    await open(page);
    await pasteData(page, { "text/plain": "a\tb\tc\nd\te\tf\ng\th\ti" });
    await clickCell(page, 5, 5);
    await pasteData(page, { "text/plain": "a\tb\tc\nd\te\tf\ng\th\ti" });
    const grid = await rows(page);
    expect(grid).toHaveLength(8);
    expect(grid[0]).toHaveLength(8);
    expect(grid[7]?.[7]).toBe("i");
  });
});

test.describe("5 · clipboard from other apps (synthetic paste events, recorded formats)", () => {
  test("Excel: HTML with x:num numbers and a line break in a cell", async ({ page }) => {
    await open(page);
    await clickCell(page, 0, 0);
    await pasteData(page, { "text/html": EXCEL_HTML, "text/plain": EXCEL_TSV });
    expect(await rawAt(page, 0, 0)).toBe("Peren");
    expect(await rawAt(page, 0, 1)).toBe("1234.5");
    expect(await rawAt(page, 1, 0)).toBe("Druiven\nwit");
    expect(await rawAt(page, 1, 1)).toBe("2.75");
  });

  test("Excel: TSV only (quoted cell with a newline, nl currency text)", async ({ page }) => {
    await open(page);
    await clickCell(page, 0, 2);
    await pasteData(page, { "text/plain": EXCEL_TSV });
    expect(await rawAt(page, 1, 2)).toBe("Druiven\nwit");
    // prijs is an nl-NL currency column: "€ 1.234,50" → 1234.5
    expect(await rawAt(page, 0, 3)).toBe("1234.5");
  });

  test("Google Sheets: R1C1 formulas become our relative refs", async ({ page }) => {
    await open(page, "empty");
    await clickCell(page, 1, 1);
    await pasteData(page, { "text/html": SHEETS_HTML, "text/plain": SHEETS_TSV });
    expect(await rawAt(page, 1, 1)).toBe("5");
    expect(await rawAt(page, 1, 2)).toBe("=b2*2");
    expect(await rawAt(page, 2, 2)).toBe("=b3*2");
    await expect(cell(page, 2, 2)).toHaveText("14");
  });

  test("Numbers: Cocoa HTML table, comma decimals", async ({ page }) => {
    await open(page);
    await clickCell(page, 0, 0);
    await pasteData(page, { "text/html": NUMBERS_HTML, "text/plain": NUMBERS_TSV });
    expect(await rawAt(page, 0, 0)).toBe("Mango");
    expect(await rawAt(page, 0, 1)).toBe("3.5");
    expect(await rawAt(page, 1, 1)).toBe("12");
  });

  test("a payload from another document pastes values (row ids mean nothing there)", async ({ page }) => {
    await open(page);
    const clip = { v: 1, cells: [["=aantal@r_elsewhere*2"]], values: [["42"]], origin: { r: 0, c: 0 }, doc: "other-doc" };
    const html = `<table data-ycsv="${JSON.stringify(clip).replaceAll('"', "&quot;")}"><tr><td>42</td></tr></table>`;
    await clickCell(page, 2, 5);
    await pasteData(page, { "text/html": html, "text/plain": "42" });
    expect(await rawAt(page, 2, 5)).toBe("42");
  });
});

test.describe("5 · menu copy/paste (async Clipboard API)", () => {
  test("Copy and Paste from the context menu", async ({ page }) => {
    await open(page);
    await clickCell(page, 1, 0);
    await cell(page, 1, 0).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Copy" }).click();
    await cell(page, 3, 5).click({ button: "right" });
    await page.getByRole("menuitem", { name: /^Paste(?! values)/ }).click();
    await expect.poll(() => rawAt(page, 3, 5)).toBe("Brood");
  });
});
