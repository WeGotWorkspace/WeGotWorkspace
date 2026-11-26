import { expect, type Page } from "@playwright/test";

export const MOD = process.platform === "darwin" ? "Meta" : "Control";

export async function open(page: Page, story = "grid") {
  await page.goto(`/iframe.html?id=spike-6-cell-ux--${story}&viewMode=story`);
  await expect(page.getByTestId("grid")).toBeVisible();
  await page.waitForFunction(() => !!window.__sheet);
  // Focus the grid the way a user does: click the first cell.
  await clickCell(page, 0, 0);
}

export function cell(page: Page, r: number, c: number) {
  return page.locator(`[role="gridcell"][id$="-cell-${r}-${c}"]`);
}

export async function center(page: Page, r: number, c: number) {
  const box = await cell(page, r, c).boundingBox();
  if (!box) throw new Error(`cell ${r},${c} not rendered`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

export async function clickCell(page: Page, r: number, c: number, modifiers: ("Shift" | "Meta" | "Control" | "Alt")[] = []) {
  const { x, y } = await center(page, r, c);
  for (const m of modifiers) await page.keyboard.down(m);
  await page.mouse.click(x, y);
  for (const m of modifiers) await page.keyboard.up(m);
}

export async function dragCells(page: Page, from: [number, number], to: [number, number]) {
  const a = await center(page, ...from);
  const b = await center(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 3 });
  await page.mouse.move(b.x, b.y, { steps: 3 });
  await page.mouse.up();
}

/** File-form cells (what the .ycsv file would hold). */
export async function rows(page: Page): Promise<string[][]> {
  return page.evaluate(() => window.__sheet!.cells());
}

export async function rawAt(page: Page, r: number, c: number) {
  return (await rows(page))[r]?.[c] ?? "";
}

export async function nameBox(page: Page) {
  return (await page.getByTestId("namebox").textContent()) ?? "";
}

export async function activeId(page: Page) {
  return page.getByTestId("cell-input").getAttribute("aria-activedescendant");
}

/** Dispatch a paste event with given flavours on the focused grid input. */
export async function pasteData(page: Page, data: Record<string, string>) {
  await page.evaluate((d) => {
    const dt = new DataTransfer();
    for (const [type, value] of Object.entries(d)) dt.setData(type, value);
    const input = document.querySelector('[data-testid="cell-input"]') as HTMLInputElement;
    input.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, data);
}
