import { expect, test, type Page } from "@playwright/test";
import { cell, clickCell, dragCells, open, rawAt } from "./helpers";

const input = (page: Page) => page.getByTestId("cell-input");

test.describe("4 · formula editing", () => {
  test.beforeEach(async ({ page }) => open(page));

  test("click inserts a reference; a second click replaces it; operators start a new one", async ({ page }) => {
    await clickCell(page, 4, 5);
    await page.keyboard.type("=");
    await clickCell(page, 0, 1);
    await expect(input(page)).toHaveValue("=aantal1");
    await clickCell(page, 2, 1);
    await expect(input(page)).toHaveValue("=aantal3");
    await page.keyboard.type("+");
    await clickCell(page, 1, 2);
    await expect(input(page)).toHaveValue("=aantal3+prijs2");
    await page.keyboard.press("Enter");
    expect(await rawAt(page, 4, 5)).toBe("=aantal3+prijs2");
    await expect(cell(page, 4, 5)).toHaveText("3.99");
  });

  test("a pick in the edited row inserts the bare column name (this row)", async ({ page }) => {
    await clickCell(page, 1, 5);
    await page.keyboard.type("=");
    await clickCell(page, 1, 1);
    await page.keyboard.type("*");
    await clickCell(page, 1, 2);
    await expect(input(page)).toHaveValue("=aantal*prijs");
    await page.keyboard.press("Enter");
    await expect(cell(page, 1, 5)).toHaveText("5.98");
  });

  test("drag inserts a range; Shift+click extends it", async ({ page }) => {
    await clickCell(page, 4, 5);
    await page.keyboard.type("=SUM(");
    await dragCells(page, [0, 1], [3, 1]);
    await expect(input(page)).toHaveValue("=SUM(aantal1:aantal4");
    await page.keyboard.type(",");
    await clickCell(page, 0, 2);
    await clickCell(page, 1, 3, ["Shift"]);
    await expect(input(page)).toHaveValue("=SUM(aantal1:aantal4,prijs1:totaal2");
    await page.keyboard.type(")");
    await page.keyboard.press("Enter");
    await expect(cell(page, 4, 5)).toHaveText("25.9428");
  });

  test("arrow keys point at cells in Enter mode; Shift+arrows grow the range", async ({ page }) => {
    await clickCell(page, 4, 5);
    await page.keyboard.type("=");
    await page.keyboard.press("ArrowUp");
    await expect(input(page)).toHaveValue("=notitie4");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(input(page)).toHaveValue("=prijs4");
    await page.keyboard.press("Shift+ArrowUp");
    await page.keyboard.press("Shift+ArrowUp");
    await expect(input(page)).toHaveValue("=prijs2:prijs4");
    await page.keyboard.press("Escape");
    expect(await rawAt(page, 4, 5)).toBe("");
  });

  test("token colours match the range outlines on the grid", async ({ page }) => {
    await clickCell(page, 4, 5);
    await page.keyboard.type("=aantal1+SUM(prijs1:prijs3)+aantal1");
    const tokens = page.getByTestId("mirror").locator("[data-ref-color]");
    await expect(tokens).toHaveCount(3);
    const tokenColors = await tokens.evaluateAll((els) => els.map((el) => getComputedStyle(el).color));
    // aantal1 twice: same colour; the range: another colour.
    expect(tokenColors[0]).toBe(tokenColors[2]);
    expect(tokenColors[0]).not.toBe(tokenColors[1]);
    const outlines = page.locator(".sx-o-ref");
    await expect(outlines).toHaveCount(3);
    const outlineColors = await outlines.evaluateAll((els) => els.map((el) => getComputedStyle(el).color));
    expect(new Set(outlineColors)).toEqual(new Set(tokenColors));
    // The range outline covers three rows.
    const range = outlines.nth(1);
    const box = await range.boundingBox();
    const top = await cell(page, 0, 2).boundingBox();
    expect(Math.round(box!.height)).toBe(Math.round(top!.height * 3));
  });

  test("function autocomplete with signature help", async ({ page }) => {
    await clickCell(page, 4, 5);
    await page.keyboard.type("=su");
    const list = page.getByRole("listbox", { name: "Suggestions" });
    await expect(list).toBeVisible();
    await expect(list.getByRole("option").first()).toContainText("SUM");
    await expect(input(page)).toHaveAttribute("aria-activedescendant", /-ac-0$/);
    await page.keyboard.press("Tab");
    await expect(input(page)).toHaveValue("=SUM(");
    const sig = page.getByTestId("signature");
    await expect(sig).toContainText("SUM(number1, [number2], …)");
    await expect(sig.locator("b")).toHaveText("number1");
    await page.keyboard.type("1,");
    await expect(sig.locator("b")).toHaveText("[number2]");
  });

  test("column and defined-name autocomplete; Escape closes the list first", async ({ page }) => {
    await clickCell(page, 4, 5);
    await page.keyboard.type("=aan");
    const list = page.getByRole("listbox", { name: "Suggestions" });
    await expect(list.getByRole("option").first()).toContainText("aantal");
    await page.keyboard.press("Enter");
    await expect(input(page)).toHaveValue("=aantal");
    await page.keyboard.type("*bt");
    await expect(list.getByRole("option").first()).toContainText("btw");
    await page.keyboard.press("Escape");
    await expect(list).toBeHidden();
    await expect(page.getByTestId("edit-mode")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("edit-mode")).toBeHidden();
  });

  test("error states: #REF!, #CYCLE!, unknown names while typing", async ({ page }) => {
    await expect(cell(page, 5, 1)).toHaveText("#REF!");
    await expect(cell(page, 5, 1)).toHaveAttribute("title", /no longer exists/);
    await expect(cell(page, 5, 3)).toHaveText("#CYCLE!");
    await expect(cell(page, 5, 3)).toHaveAttribute("title", /depends on itself/);
    await clickCell(page, 4, 5);
    await page.keyboard.type("=onbekend*2");
    await expect(page.getByTestId("mirror").locator(".sx-t-name-unknown")).toHaveText("onbekend");
    await page.keyboard.press("Enter");
    await expect(cell(page, 4, 5)).toHaveText("#NAME!");
  });
});
