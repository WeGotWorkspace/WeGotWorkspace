import { expect, test, type Page } from "@playwright/test";
import { center, clickCell, MOD, nameBox, open, rawAt, rows } from "./helpers";

async function typeAt(page: Page, r: number, c: number, text: string) {
  await clickCell(page, r, c);
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}

async function dragHandleTo(page: Page, r: number, c: number, opts: { alt?: boolean } = {}) {
  const handle = await page.getByTestId("fill-handle").boundingBox();
  if (!handle) throw new Error("no fill handle");
  const to = await center(page, r, c);
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await expect(page.getByTestId("fill-preview")).toBeVisible();
  if (opts.alt) await page.keyboard.down("Alt");
  await page.mouse.up();
  if (opts.alt) await page.keyboard.up("Alt");
}

const col = (grid: string[][], c: number, from: number, to: number) => grid.slice(from, to + 1).map((row) => row[c]);

test.describe("3 · fill handle", () => {
  test("number series down, and up", async ({ page }) => {
    await open(page, "empty");
    await typeAt(page, 0, 0, "1");
    await typeAt(page, 1, 0, "3");
    await clickCell(page, 0, 0);
    await clickCell(page, 1, 0, ["Shift"]);
    await dragHandleTo(page, 5, 0);
    expect(col(await rows(page), 0, 0, 5)).toEqual(["1", "3", "5", "7", "9", "11"]);
    expect(await nameBox(page)).toBe("a1:a6");

    await typeAt(page, 8, 1, "10");
    await typeAt(page, 9, 1, "20");
    await clickCell(page, 8, 1);
    await clickCell(page, 9, 1, ["Shift"]);
    // Drag up: the handle sits at the bottom, the pointer goes above the range.
    await dragHandleTo(page, 6, 1);
    expect(col(await rows(page), 1, 6, 9)).toEqual(["-10", "0", "10", "20"]);
  });

  test("one number copies; Option/Alt-drag counts up", async ({ page }) => {
    await open(page, "empty");
    await typeAt(page, 0, 0, "5");
    await clickCell(page, 0, 0);
    await dragHandleTo(page, 2, 0);
    expect(col(await rows(page), 0, 0, 2)).toEqual(["5", "5", "5"]);
    await clickCell(page, 0, 0);
    await dragHandleTo(page, 2, 0, { alt: true });
    expect(col(await rows(page), 0, 0, 2)).toEqual(["5", "6", "7"]);
  });

  test("dates, text with a number, weekdays", async ({ page }) => {
    await open(page);
    // datum: 2026-01-01, 2026-01-02 → +1 day.
    await clickCell(page, 0, 4);
    await clickCell(page, 1, 4, ["Shift"]);
    await dragHandleTo(page, 4, 4);
    expect(col(await rows(page), 4, 0, 4)).toEqual(["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05"]);
    // notitie: "Item 1" → Item 2…
    await clickCell(page, 0, 5);
    await dragHandleTo(page, 3, 5);
    expect(col(await rows(page), 5, 0, 3)).toEqual(["Item 1", "Item 2", "Item 3", "Item 4"]);
    // Weekdays keep their case.
    await typeAt(page, 0, 0, "Maandag");
    await clickCell(page, 0, 0);
    await dragHandleTo(page, 2, 0);
    expect(col(await rows(page), 0, 0, 2)).toEqual(["Maandag", "Dinsdag", "Woensdag"]);
  });

  test("formulas: relative refs move, $ refs stay, same-row column names stay", async ({ page }) => {
    await open(page, "empty");
    for (let r = 0; r < 4; r += 1) await typeAt(page, r, 0, String(r + 1));
    await typeAt(page, 0, 1, "=a1*2+$a$1");
    await typeAt(page, 0, 2, "=a*10");
    await clickCell(page, 0, 1);
    await clickCell(page, 0, 2, ["Shift"]);
    await dragHandleTo(page, 3, 2);
    const grid = await rows(page);
    expect(col(grid, 1, 0, 3)).toEqual(["=a1*2+$a$1", "=a2*2+$a$1", "=a3*2+$a$1", "=a4*2+$a$1"]);
    expect(col(grid, 2, 0, 3)).toEqual(["=a*10", "=a*10", "=a*10", "=a*10"]);
    // Fill right: column refs move one column over, $ columns stay.
    await clickCell(page, 0, 1);
    await dragHandleTo(page, 0, 3);
    expect(await rawAt(page, 0, 3)).toBe("=c1*2+$a$1");
  });

  test("double-click on the handle fills down as far as the neighbour column", async ({ page }) => {
    await open(page, "empty");
    for (let r = 0; r < 6; r += 1) await typeAt(page, r, 0, String((r + 1) * 10));
    await typeAt(page, 0, 1, "=a1/10");
    await clickCell(page, 0, 1);
    await page.getByTestId("fill-handle").dblclick();
    expect(col(await rows(page), 1, 0, 6)).toEqual(["=a1/10", "=a2/10", "=a3/10", "=a4/10", "=a5/10", "=a6/10", ""]);
  });

  test("Cmd/Ctrl+D copies the top row down", async ({ page }) => {
    await open(page, "empty");
    await typeAt(page, 0, 0, "7");
    await typeAt(page, 0, 1, "=a1+1");
    await clickCell(page, 0, 0);
    await clickCell(page, 2, 1, ["Shift"]);
    await page.keyboard.press(`${MOD}+d`);
    const grid = await rows(page);
    expect(col(grid, 0, 0, 2)).toEqual(["7", "7", "7"]);
    expect(col(grid, 1, 0, 2)).toEqual(["=a1+1", "=a2+1", "=a3+1"]);
  });
});
