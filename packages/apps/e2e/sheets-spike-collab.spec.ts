// Sheets spike 5 (not in the live tier list): a YCSV sheet on the real Docs
// collab transport. Two people (admin + member) in two browser contexts on a
// Team file: cell edits, presence (active cell, range, editing), concurrent
// row insert + formula edit, per-user undo, the server document half as
// canonical YCSV, a cold reopen from the server save, and an offline merge.
//
// Run against an own stack, e.g.:
//   WGW_APPS_E2E_BASE_URL=http://127.0.0.1:5480 WGW_E2E_API_URL=http://127.0.0.1:9480 \
//   WGW_APPS_E2E_NO_SERVER=1 pnpm exec playwright test --config playwright.live.config.mjs \
//   --grep-invert @none e2e/sheets-spike-collab.spec.ts
import { expect, test, type Browser, type Page } from "./helpers/live-test";
import {
  OWNER,
  TEAMMATE,
  openUser,
  putDoc,
  readDoc,
  removeQuietly,
  setTabOffline,
  type Tab,
} from "./helpers/docs-matrix";

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ timeout: 240_000 });

const SEED = `---
ycsv_version: 1
name: Q3
columns:
  - ref: product
    type: string
  - ref: aantal
    type: number
  - ref: prijs
    type: number
  - ref: totaal
    type: number
---
product,aantal,prijs,totaal
Appels,6,0.5,=aantal*prijs
Brood,2,3,=aantal*prijs
Kaas,1,4.5,=aantal*prijs
Wijn,3,9,=aantal*prijs
`;

const cell = (page: Page, row: number, ref: string) => page.getByTestId(`cell-${row}-${ref}`);

async function open(browser: Browser, user: string, label: string, file: string): Promise<Tab> {
  const context = await openUser(browser, user);
  const page = (await context.newPage()) as Tab;
  page.tag = label;
  page.user = user;
  await page.goto(`/sheets-spike.html?file=${encodeURIComponent(file)}&user=${label}`);
  await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 60_000 });
  return page;
}

async function edit(page: Page, row: number, ref: string, text: string): Promise<void> {
  await cell(page, row, ref).dblclick();
  const input = page.getByTestId("cell-editor");
  await input.fill(text);
  await input.press("Enter");
}

/** The grid's file-form text, row by row: what both people must agree on. */
async function gridText(page: Page): Promise<string> {
  return page.evaluate(() =>
    [...document.querySelectorAll("[data-testid='sheet-grid'] tbody tr")]
      .map((tr) => [...tr.querySelectorAll("td")].map((td) => td.dataset.raw ?? "").join(","))
      .join("\n"),
  );
}

test("YCSV sheet on the Docs collab transport: two people, presence, undo, save, reopen, offline", async ({
  browser,
}) => {
  const name = `sheet-spike-${Date.now()}.ycsv`;
  const apiPath = `/groups/team/${name}`;
  const file = apiPath.slice(1);
  await putDoc(OWNER, apiPath, SEED);
  try {
    const ann = await open(browser, OWNER, "Ann", file);
    const bob = await open(browser, TEAMMATE, "Bob", file);
    await expect(ann.getByTestId("sheet-status")).toHaveAttribute("data-peers", "1", { timeout: 60_000 });
    await expect(bob.getByTestId("sheet-status")).toHaveAttribute("data-peers", "1", { timeout: 60_000 });

    await test.step("cell edits reach the other person", async () => {
      await edit(ann, 1, "product", "Peren");
      await edit(bob, 2, "aantal", "7");
      await expect(cell(bob, 1, "product")).toHaveAttribute("data-raw", "Peren");
      await expect(cell(ann, 2, "aantal")).toHaveAttribute("data-raw", "7");
      // The formula re-evaluates on the other side: 7 * 3.
      await expect(cell(ann, 2, "totaal")).toHaveText("21");
    });

    await test.step("presence: active cell, range and editing state", async () => {
      await cell(ann, 3, "prijs").click();
      await cell(ann, 4, "totaal").click({ modifiers: ["Shift"] });
      await expect(cell(bob, 4, "totaal")).toHaveAttribute("data-peer-active", "Ann");
      for (const [r, ref] of [[3, "prijs"], [3, "totaal"], [4, "prijs"], [4, "totaal"]] as const) {
        await expect(cell(bob, r, ref)).toHaveAttribute("data-peer-range", "Ann");
      }
      await expect(cell(bob, 2, "prijs")).toHaveAttribute("data-peer-range", "");
      await cell(ann, 4, "totaal").dblclick();
      await expect(cell(bob, 4, "totaal")).toHaveAttribute("data-peer-editing", "true");
      await ann.getByTestId("cell-editor").press("Escape");
      await expect(cell(bob, 4, "totaal")).toHaveAttribute("data-peer-editing", "false");
      await expect(cell(ann, 4, "totaal")).toHaveAttribute("data-peer-active", "");
      await cell(bob, 1, "aantal").click();
      await expect(cell(ann, 1, "aantal")).toHaveAttribute("data-peer-active", "Bob");
    });

    await test.step("concurrent row insert + formula edit: the formula follows its row", async () => {
      // Bob inserts a row under row 1 while Ann writes an explicit-row formula on Kaas (row 3).
      await cell(bob, 1, "product").click();
      await Promise.all([
        bob.getByTestId("insert-row").click(),
        edit(ann, 3, "totaal", "=aantal3*prijs3+1"),
      ]);
      for (const page of [ann, bob]) {
        await expect(cell(page, 4, "product")).toHaveAttribute("data-raw", "Kaas");
        await expect(cell(page, 4, "totaal")).toHaveAttribute("data-raw", "=aantal4*prijs4+1");
        await expect(cell(page, 4, "totaal")).toHaveText("5.5");
      }
      await expect.poll(() => gridText(bob)).toBe(await gridText(ann));
    });

    await test.step("per-user undo: Ann's undo reverts only Ann's last edit", async () => {
      await ann.getByTestId("undo").click();
      for (const page of [ann, bob]) {
        await expect(cell(page, 4, "totaal")).toHaveAttribute("data-raw", "=aantal*prijs");
        await expect(cell(page, 3, "aantal")).toHaveAttribute("data-raw", "7"); // Bob's edit stays
        await expect(cell(page, 1, "product")).toHaveAttribute("data-raw", "Peren");
        await expect(cell(page, 2, "product")).toHaveAttribute("data-raw", ""); // Bob's row stays
      }
    });

    await test.step("server document half is canonical YCSV, with a Yjs sidecar", async () => {
      await ann.getByTestId("save-now").click();
      await expect
        .poll(async () => readDoc(OWNER, apiPath), { timeout: 30_000 })
        .toContain("Peren,6,0.5,=aantal*prijs");
      const stored = (await readDoc(OWNER, apiPath)) ?? "";
      expect(stored.startsWith("---\nycsv_version: 1\n")).toBe(true);
      expect(stored).toContain("Brood,7,3,=aantal*prijs");
      expect(stored).toContain("Kaas,1,4.5,=aantal*prijs");
      expect(stored).toContain("\n,,,\n"); // the inserted row
      expect(stored).not.toMatch(/@r_/); // never the id form
      const sidecar = await readDoc(OWNER, `/groups/team/.${name}.yjs`);
      expect(sidecar).not.toBeNull();
    });

    await test.step("offline edits merge after reconnect", async () => {
      await setTabOffline(ann, true);
      await edit(ann, 1, "aantal", "11");
      await edit(bob, 1, "prijs", "0.75");
      await expect(cell(bob, 1, "aantal")).toHaveAttribute("data-raw", "6");
      await setTabOffline(ann, false);
      for (const page of [ann, bob]) {
        await expect(cell(page, 1, "aantal")).toHaveAttribute("data-raw", "11", { timeout: 60_000 });
        await expect(cell(page, 1, "prijs")).toHaveAttribute("data-raw", "0.75", { timeout: 60_000 });
        await expect(cell(page, 1, "totaal")).toHaveText("8.25");
      }
      await ann.getByTestId("save-now").click();
      await expect
        .poll(async () => readDoc(OWNER, apiPath), { timeout: 30_000 })
        .toContain("Peren,11,0.75,=aantal*prijs");
    });

    const expected = await gridText(ann);
    await ann.context().close();
    await bob.context().close();

    await test.step("a cold browser reopens the sheet from the server save", async () => {
      const cold = await open(browser, TEAMMATE, "Cleo", file);
      await expect.poll(() => gridText(cold), { timeout: 30_000 }).toBe(expected);
      await cold.context().close();
    });
  } finally {
    await removeQuietly(OWNER, [apiPath]);
  }
});
