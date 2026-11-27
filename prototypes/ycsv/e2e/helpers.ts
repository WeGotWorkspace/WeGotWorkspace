import { expect, type Page } from "@playwright/test";

export const MOD = process.platform === "darwin" ? "Meta" : "Control";

/** FOCUS_MODEL=cell runs the spike 6 suites against the spike 8 focus model. */
export const FOCUS_MODEL = process.env.FOCUS_MODEL ?? "";

export async function open(page: Page, story = "grid") {
  const args = FOCUS_MODEL && !story.startsWith("a-11-y") ? `&args=focusModel:${FOCUS_MODEL}` : "";
  await page.goto(`/iframe.html?id=spike-6-cell-ux--${story}&viewMode=story${args}`);
  await expect(page.getByTestId("grid")).toBeVisible();
  await page.waitForFunction(() => !!window.__sheet);
  // Focus the grid the way a user does: click the first cell.
  await clickCell(page, 0, 0);
}

export function cell(page: Page, r: number, c: number) {
  return page.locator(`[role="gridcell"][id$="-cell-${r}-${c}"]`);
}

/**
 * Shown text of a cell. In the cell focus model the focused cell is an empty editing host and
 * draws its value from data-text, so read that when present.
 */
export async function expectCellText(page: Page, r: number, c: number, text: string) {
  const el = cell(page, r, c);
  await expect
    .poll(async () => (await el.getAttribute("data-text")) ?? (await el.textContent()) ?? "")
    .toBe(text);
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
  return page.getByTestId("namebox").inputValue();
}

/** Id of the active gridcell, whichever focus model is on. */
export async function activeId(page: Page) {
  const ad = await page.getByTestId("cell-input").getAttribute("aria-activedescendant");
  if (ad) return ad;
  return page.evaluate(() => (document.activeElement?.getAttribute("role") === "gridcell" ? document.activeElement.id : null));
}

/** The element that holds focus while navigating: the input (descendant model) or the active cell. */
export function focusHolder(page: Page) {
  return FOCUS_MODEL === "cell" ? page.getByTestId("focus-cell") : page.getByTestId("cell-input");
}

/** Dispatch a paste event with given flavours on the focused grid input. */
export async function pasteData(page: Page, data: Record<string, string>) {
  await page.evaluate((d) => {
    const dt = new DataTransfer();
    for (const [type, value] of Object.entries(d)) dt.setData(type, value);
    const input = (document.querySelector('[data-testid="focus-cell"]') ?? document.querySelector('[data-testid="cell-input"]')) as HTMLElement;
    input.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, data);
}
