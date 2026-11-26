import { expect, test } from "@playwright/test";
import { cell, clickCell, MOD, nameBox, open, rawAt } from "./helpers";

test.describe("2 · editing", () => {
  test.beforeEach(async ({ page }) => open(page));

  test("type-to-replace, Enter commits and moves down", async ({ page }) => {
    await page.keyboard.type("Peren");
    await expect(page.getByTestId("edit-mode")).toHaveText("Enter");
    await page.keyboard.press("Enter");
    expect(await rawAt(page, 0, 0)).toBe("Peren");
    expect(await nameBox(page)).toBe("product2");
  });

  test("type-to-replace with a dead key (é via Option+e) and IME-style composition", async ({ page }) => {
    // A composition starting in navigation mode must land in the cell, not get lost.
    const input = page.getByTestId("cell-input");
    await input.evaluate((el: HTMLInputElement) => {
      el.dispatchEvent(new CompositionEvent("compositionstart", { data: "" }));
    });
    await page.keyboard.insertText("é");
    await page.keyboard.type("clair");
    await page.keyboard.press("Enter");
    expect(await rawAt(page, 0, 0)).toBe("éclair");
  });

  test("Enter and F2 open the editor with the caret at the end; arrows move the caret", async ({ page }) => {
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("edit-mode")).toHaveText("Edit");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.type("X");
    await page.keyboard.press("Enter");
    expect(await rawAt(page, 0, 0)).toBe("AppelXs");
    await clickCell(page, 1, 0);
    await page.keyboard.press("F2");
    await page.keyboard.type("je");
    await page.keyboard.press("Tab");
    expect(await rawAt(page, 1, 0)).toBe("Broodje");
    expect(await nameBox(page)).toBe("aantal2");
  });

  test("F2 toggles Enter (point) mode and Edit (caret) mode", async ({ page }) => {
    await page.keyboard.type("abc");
    await page.keyboard.press("F2");
    await expect(page.getByTestId("edit-mode")).toHaveText("Edit");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.type("-");
    await page.keyboard.press("F2");
    await expect(page.getByTestId("edit-mode")).toHaveText("Enter");
    await page.keyboard.press("ArrowDown");
    expect(await rawAt(page, 0, 0)).toBe("ab-c");
    expect(await nameBox(page)).toBe("product2");
  });

  test("Escape cancels; double-click edits", async ({ page }) => {
    await page.keyboard.type("weg");
    await page.keyboard.press("Escape");
    expect(await rawAt(page, 0, 0)).toBe("Appels");
    await cell(page, 2, 0).dblclick();
    await expect(page.getByTestId("edit-mode")).toHaveText("Edit");
    await page.keyboard.type("!");
    await page.keyboard.press("Enter");
    expect(await rawAt(page, 2, 0)).toBe("Kaas!");
  });

  test("Enter and Tab walk inside a selected range", async ({ page }) => {
    await clickCell(page, 0, 1);
    await clickCell(page, 1, 2, ["Shift"]);
    await page.keyboard.type("10");
    await page.keyboard.press("Enter");
    await page.keyboard.type("20");
    await page.keyboard.press("Enter");
    await page.keyboard.type("30");
    await page.keyboard.press("Enter");
    // The range is still selected and the active cell wrapped to its start.
    expect(await nameBox(page)).toBe("aantal1:prijs2");
    expect(await rawAt(page, 0, 1)).toBe("10");
    expect(await rawAt(page, 1, 1)).toBe("20");
    expect(await rawAt(page, 0, 2)).toBe("30");
  });

  test("Delete clears every selected range; undo and redo restore it in one step", async ({ page }) => {
    await clickCell(page, 0, 1);
    await clickCell(page, 1, 2, ["Shift"]);
    await clickCell(page, 3, 0, [MOD as "Meta"]);
    await page.keyboard.press("Delete");
    expect(await rawAt(page, 0, 1)).toBe("");
    expect(await rawAt(page, 1, 2)).toBe("");
    expect(await rawAt(page, 3, 0)).toBe("");
    await page.keyboard.press(`${MOD}+z`);
    expect(await rawAt(page, 0, 1)).toBe("6");
    expect(await rawAt(page, 1, 2)).toBe("2.99");
    expect(await rawAt(page, 3, 0)).toBe("Wijn");
    // Undo brings the selection back too.
    expect(await nameBox(page)).toBe("2 ranges");
    await page.keyboard.press(`Shift+${MOD}+z`);
    expect(await rawAt(page, 3, 0)).toBe("");
  });

  test("formula bar edits the active cell", async ({ page }) => {
    await clickCell(page, 1, 1);
    await expect(page.getByTestId("formula-bar")).toHaveValue("2");
    await page.getByTestId("formula-bar").click();
    await page.getByTestId("formula-bar").fill("7");
    await page.keyboard.press("Enter");
    expect(await rawAt(page, 1, 1)).toBe("7");
    await expect(page.getByTestId("cell-input")).toBeFocused();
    await expect(cell(page, 1, 3)).toHaveText("€ 25,33");
  });
});
