import { expect, test } from "@playwright/test";
import { activeId, cell, clickCell, dragCells, MOD, nameBox, open, focusHolder, expectCellText } from "./helpers";

test.describe("1 · selection", () => {
  test.beforeEach(async ({ page }) => open(page));

  test("arrows move, Shift+arrows extend", async ({ page }) => {
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowRight");
    expect(await nameBox(page)).toBe("aantal2");
    await page.keyboard.press("Shift+ArrowDown");
    await page.keyboard.press("Shift+ArrowRight");
    expect(await nameBox(page)).toBe("aantal2:prijs3");
    await expect(cell(page, 2, 2)).toHaveAttribute("aria-selected", "true");
    // The active cell stays where the range started.
    expect(await activeId(page)).toMatch(/-cell-1-1$/);
    await page.keyboard.press("ArrowUp");
    expect(await nameBox(page)).toBe("aantal1");
  });

  test("Cmd/Ctrl+arrows jump to the data edge, with Shift they extend", async ({ page }) => {
    await page.keyboard.press(`${MOD}+ArrowDown`);
    expect(await nameBox(page)).toBe("product6");
    await page.keyboard.press(`${MOD}+ArrowUp`);
    expect(await nameBox(page)).toBe("product1");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    // prijs: filled 1..4, empty 5, 6.
    await page.keyboard.press(`${MOD}+ArrowDown`);
    expect(await nameBox(page)).toBe("prijs4");
    await page.keyboard.press(`${MOD}+ArrowDown`);
    expect(await nameBox(page)).toBe("prijs6");
    await clickCell(page, 0, 0);
    await page.keyboard.press(`Shift+${MOD}+ArrowRight`);
    expect(await nameBox(page)).toBe("product1:notitie1");
  });

  test("click, Shift+click, drag and Cmd/Ctrl+click", async ({ page }) => {
    await clickCell(page, 1, 1);
    await clickCell(page, 3, 2, ["Shift"]);
    expect(await nameBox(page)).toBe("aantal2:prijs4");
    await dragCells(page, [0, 0], [2, 3]);
    expect(await nameBox(page)).toBe("product1:totaal3");
    await clickCell(page, 4, 4, [MOD as "Meta"]);
    expect(await nameBox(page)).toBe("2 ranges");
    await expect(cell(page, 1, 1)).toHaveAttribute("aria-selected", "true");
    await expect(cell(page, 4, 4)).toHaveAttribute("aria-selected", "true");
    await expect(cell(page, 4, 3)).toHaveAttribute("aria-selected", "false");
  });

  test("row and column headers, Cmd/Ctrl+A, Shift+Space", async ({ page }) => {
    await page.getByTestId("colhead-2").click();
    expect(await nameBox(page)).toBe("prijs1:prijs6");
    await expect(page.getByTestId("colhead-2")).toHaveClass(/is-whole/);
    await page.getByTestId("colhead-3").click({ modifiers: ["Shift"] });
    expect(await nameBox(page)).toBe("prijs1:totaal6");
    const rowHead = page.locator('[role="rowheader"]').nth(2);
    await rowHead.click();
    expect(await nameBox(page)).toBe("product3:notitie3");
    await page.keyboard.press(`${MOD}+a`);
    expect(await nameBox(page)).toBe("product1:notitie6");
    await clickCell(page, 1, 1);
    await page.keyboard.press("Shift+Space");
    expect(await nameBox(page)).toBe("product2:notitie2");
    await page.getByTestId("corner").click();
    expect(await nameBox(page)).toBe("product1:notitie6");
  });

  test("ARIA grid pattern", async ({ page }) => {
    const grid = page.getByRole("grid", { name: "Sheet" });
    await expect(grid).toHaveAttribute("aria-rowcount", "7");
    await expect(grid).toHaveAttribute("aria-colcount", "7");
    await expect(grid).toHaveAttribute("aria-multiselectable", "true");
    await expect(page.getByRole("columnheader", { name: /Prijs/ })).toBeVisible();
    await page.keyboard.press("ArrowDown");
    const id = await activeId(page);
    expect(id).toBeTruthy();
    const target = page.locator(`#${id}`);
    await expect(target).toHaveAttribute("role", "gridcell");
    await expect(target).toHaveAttribute("aria-selected", "true");
    await expectCellText(page, 1, 0, "Brood");
    // Focus stays on the one input; it is the grid's focus holder.
    await expect(focusHolder(page)).toBeFocused();
  });
});

test.describe("1 · selection on a virtualized grid", () => {
  test("10 000 rows: jump to the end, few DOM rows, active cell rendered", async ({ page }) => {
    await open(page, "ten-thousand-rows");
    const rendered = await page.locator('[role="row"]').count();
    expect(rendered).toBeLessThan(80);
    await page.keyboard.press(`${MOD}+ArrowDown`);
    expect(await nameBox(page)).toBe("id10000");
    const id = await activeId(page);
    expect(id).toMatch(/-cell-9999-0$/);
    await expectCellText(page, 9999, 0, "10000");
    await page.keyboard.press(`Shift+${MOD}+ArrowUp`);
    expect(await nameBox(page)).toBe("id1:id10000");
    expect(await page.locator('[role="row"]').count()).toBeLessThan(80);
    // Status bar sums the whole range, not only rendered rows.
    await expect(page.getByTestId("status")).toContainText("Count 10000");
  });
});
