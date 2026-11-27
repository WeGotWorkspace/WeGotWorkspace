import { expect, test, type Page } from "@playwright/test";
import { center, clickCell, dragCells, MOD } from "./helpers";

/** Run with SHOTS=1: writes light + dark screenshots of key states to docs/spike-6-ux/. */
test.skip(!process.env.SHOTS, "screenshots only with SHOTS=1");

const OUT = "docs/spike-6-ux";

async function openThemed(page: Page, story: string, theme: "light" | "dark") {
  await page.goto(`/iframe.html?id=spike-6-cell-ux--${story}&viewMode=story&args=theme:${theme}`);
  await expect(page.getByTestId("grid")).toBeVisible();
  await page.waitForFunction(() => !!window.__sheet);
  await clickCell(page, 0, 0);
}

for (const theme of ["light", "dark"] as const) {
  test.describe(theme, () => {
    test.use({ viewport: { width: 960, height: 420 }, deviceScaleFactor: 2 });

    test(`selection ${theme}`, async ({ page }) => {
      await openThemed(page, "grid", theme);
      await dragCells(page, [0, 1], [3, 2]);
      await clickCell(page, 4, 3, [MOD as "Meta"]);
      await page.screenshot({ path: `${OUT}/01-selection-${theme}.png` });
    });

    test(`formula refs + autocomplete ${theme}`, async ({ page }) => {
      await openThemed(page, "grid", theme);
      await clickCell(page, 4, 5);
      await page.keyboard.type("=aantal1+SUM(prijs1:totaal3)*bt");
      await expect(page.getByTestId("autocomplete")).toBeVisible();
      await page.screenshot({ path: `${OUT}/02-formula-autocomplete-${theme}.png` });
    });

    test(`signature help ${theme}`, async ({ page }) => {
      await openThemed(page, "grid", theme);
      await clickCell(page, 4, 5);
      await page.keyboard.type("=ROUND(");
      await dragCells(page, [0, 3], [3, 3]);
      await page.keyboard.type(", ");
      await page.screenshot({ path: `${OUT}/03-signature-help-${theme}.png` });
    });

    test(`fill handle drag ${theme}`, async ({ page }) => {
      await openThemed(page, "grid", theme);
      await clickCell(page, 0, 4);
      await clickCell(page, 1, 4, ["Shift"]);
      const handle = (await page.getByTestId("fill-handle").boundingBox())!;
      const to = await center(page, 5, 4);
      await page.mouse.move(handle.x + 4, handle.y + 4);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 5 });
      await page.screenshot({ path: `${OUT}/04-fill-drag-${theme}.png` });
      await page.mouse.up();
      await page.screenshot({ path: `${OUT}/05-fill-done-${theme}.png` });
    });

    test(`copy and context menu ${theme}`, async ({ page }) => {
      await openThemed(page, "grid", theme);
      await dragCells(page, [0, 0], [3, 1]);
      await page.keyboard.press(`${MOD}+c`);
      await page.getByTestId("colhead-2").click({ button: "right" });
      await expect(page.getByRole("menu")).toBeVisible();
      await page.screenshot({ path: `${OUT}/06-copy-and-menu-${theme}.png` });
    });

    test(`frozen rows ${theme}`, async ({ page }) => {
      await openThemed(page, "frozen-header-row", theme);
      await page.getByTestId("grid").evaluate((el) => (el.scrollTop = 1500));
      await clickCell(page, 60, 2);
      await page.screenshot({ path: `${OUT}/07-frozen-row-${theme}.png` });
    });
  });
}
