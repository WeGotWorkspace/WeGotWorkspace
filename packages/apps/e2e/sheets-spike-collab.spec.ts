// Sheets integration slice (not in the live tier list): the integrated grid
// (spikes 6+7+8 in a multi-sheet WorkbookView, spike 4 engine, spike 9 layout)
// on the real Docs collab transport. Two people (admin + member) in two browser
// contexts on a Team file: cell edits, presence (active cell, range, editing),
// a row move racing an edit in that row, sheet tabs (add, switch, peers per tab,
// cross-sheet formula), per-user undo across tabs, the server document half as
// canonical multi-sheet YCSV, and a cold reopen from the server save.
//
// Run against an own stack, e.g.:
//   WGW_APPS_E2E_BASE_URL=http://127.0.0.1:5480 WGW_E2E_API_URL=http://127.0.0.1:9480 \
//   WGW_APPS_E2E_NO_SERVER=1 pnpm exec playwright test --config playwright.sheets-spike.config.mjs
// SPIKE_ENGINE=worker runs the same test with the formula engine in a Web Worker.
import { expect, test, type Browser, type Page } from "./helpers/live-test";
import {
  OWNER,
  TEAMMATE,
  openUser,
  putDoc,
  readDoc,
  removeQuietly,
  type Tab,
} from "./helpers/docs-matrix";
import { setRtcTestOverrides } from "./helpers/rtc-test-overrides";

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ timeout: 300_000 });

const ENGINE = process.env.SPIKE_ENGINE === "worker" ? "worker" : "main";
const MOD = process.platform === "darwin" ? "Meta" : "Control";

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

const cell = (page: Page, r: number, c: number) =>
  page.locator(`[role="gridcell"][id$="-cell-${r}-${c}"]`);

async function shown(page: Page, r: number, c: number): Promise<string> {
  const el = cell(page, r, c);
  return (await el.getAttribute("data-text")) ?? (await el.textContent()) ?? "";
}

async function click(page: Page, r: number, c: number, shift = false): Promise<void> {
  const box = await cell(page, r, c).boundingBox();
  if (!box) throw new Error(`cell ${r},${c} not rendered`);
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  if (shift) await page.keyboard.up("Shift");
}

/** Type over a cell and commit with Enter, as a person does. */
async function edit(page: Page, r: number, c: number, text: string): Promise<void> {
  await click(page, r, c);
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}

const cells = (page: Page, sheetId?: string) =>
  page.evaluate((id) => window.__spike!.cells(id), sheetId);
const peerCursor = (page: Page, name: string) =>
  page.locator(`[data-testid="peer-cursor"][data-peer="${name}"]`);

async function open(browser: Browser, user: string, label: string, file: string): Promise<Tab> {
  const context = await openUser(browser, user);
  if (process.env.WGW_SPIKE_FORCE_RELAY === "1")
    await setRtcTestOverrides(context, { debug: false, forceRelay: true });
  const page = (await context.newPage()) as Tab;
  page.tag = label;
  page.user = user;
  await page.goto(
    `/sheets-spike.html?file=${encodeURIComponent(file)}&user=${label}&engine=${ENGINE}`,
  );
  await expect(page.getByTestId("grid")).toBeVisible({ timeout: 60_000 });
  await page.waitForFunction(() => !!window.__spike);
  return page;
}

test(`YCSV workbook on the Docs collab transport (engine: ${ENGINE})`, async ({ browser }) => {
  const name = `sheet-int-${Date.now()}.ycsv`;
  const apiPath = `/groups/team/${name}`;
  const file = apiPath.slice(1);
  await putDoc(OWNER, apiPath, SEED);
  try {
    const ann = await open(browser, OWNER, "Ann", file);
    const bob = await open(browser, TEAMMATE, "Bob", file);
    for (const page of [ann, bob])
      await expect(page.getByTestId("sheet-status")).toHaveAttribute("data-peers", "1", {
        timeout: 60_000,
      });

    await test.step("cell edits reach the other person and formulas re-evaluate there", async () => {
      await edit(ann, 0, 0, "Peren");
      await edit(bob, 1, 1, "7");
      await expect.poll(async () => (await cells(bob))[0]?.[0]).toBe("Peren");
      await expect.poll(async () => (await cells(ann))[1]?.[1]).toBe("7");
      await expect.poll(() => shown(ann, 1, 3)).toBe("21");
    });

    await test.step("presence: active cell, range and editing state", async () => {
      await click(ann, 2, 2);
      await click(ann, 3, 3, true);
      // Shift+click grows the range; the active cell stays at the anchor (as in Excel).
      await expect(peerCursor(bob, "Ann")).toHaveAttribute("data-cell", "2-2");
      await expect(bob.locator('[data-testid="peer-range"][data-peer="Ann"]')).toHaveAttribute(
        "data-range",
        "2-2:3-3",
      );
      await ann.keyboard.press("F2");
      await expect(peerCursor(bob, "Ann")).toHaveAttribute("data-editing", "true");
      await ann.keyboard.press("Escape");
      await expect(peerCursor(bob, "Ann")).not.toHaveAttribute("data-editing", "true");
      await click(bob, 0, 1);
      await expect(peerCursor(ann, "Bob")).toHaveAttribute("data-cell", "0-1");
    });

    await test.step("a row insert lands while a formula is being typed: the edit follows its row", async () => {
      // Ann types on Kaas (row 3, totaal) without committing; Bob inserts a row under row 1.
      await click(ann, 2, 3);
      await ann.keyboard.type("=aantal3*prijs3+1");
      await bob.evaluate(() => window.__spike!.insertRows(1, 1));
      await expect.poll(async () => (await cells(ann))[3]?.[0]).toBe("Kaas");
      await ann.keyboard.press("Enter");
      for (const page of [ann, bob]) {
        await expect
          .poll(async () => (await cells(page))[3])
          .toEqual(["Kaas", "1", "4.5", "=aantal4*prijs4+1"]);
        await expect.poll(async () => (await cells(page))[1]).toEqual(["", "", "", ""]);
      }
      await expect.poll(() => shown(bob, 3, 3)).toBe("5.5");
      // Back to four rows for the steps below (Bob deletes his empty row).
      await bob.evaluate(() => window.__spike!.deleteRow(1));
      await expect.poll(async () => (await cells(ann)).length).toBe(4);
    });

    await test.step("a row move races an edit in that row: one row, at the target, edit kept", async () => {
      const brood = (await ann.evaluate(() => window.__spike!.rowIds()))[1]!;
      await Promise.all([
        ann.evaluate(() => window.__spike!.moveRow(1, 4)), // Brood to the end
        bob.evaluate((id) => window.__spike!.setCellById(id, 2, "3.5"), brood),
      ]);
      for (const page of [ann, bob]) {
        await expect
          .poll(async () => (await cells(page)).map((row) => row[0]))
          .toEqual(["Peren", "Kaas", "Wijn", "Brood"]);
        await expect
          .poll(async () => (await cells(page))[3])
          .toEqual(["Brood", "7", "3.5", "=aantal*prijs"]);
      }
      // Bob's caret was on row 0 (Peren): it stays on Peren.
      await expect(peerCursor(ann, "Bob")).toHaveAttribute("data-cell", "0-1");
      await expect.poll(() => shown(ann, 3, 3)).toBe("24.5");
    });

    let second = "";
    await test.step("sheet tabs: add, switch, peers per tab, cross-sheet formula", async () => {
      await ann.getByTestId("add-sheet").click();
      await expect(bob.getByTestId("sheet-tab")).toHaveCount(2);
      const ids = await ann.evaluate(() => window.__spike!.sheetIds());
      second = ids[1]!;
      // Ann is on the new tab: Bob sees her dot on that tab and no caret in his grid.
      await expect(
        bob.locator(
          `[data-testid="sheet-tab"][data-sheet-id="${second}"] [data-testid="tab-peer"]`,
        ),
      ).toHaveCount(1);
      await expect(peerCursor(bob, "Ann")).toHaveCount(0);
      await edit(ann, 0, 0, "5");
      await expect.poll(async () => (await cells(bob, second))[0]?.[0]).toBe("5");
      // Bob refers to it from the first sheet.
      await edit(bob, 1, 0, "=sheet2!a1*2");
      for (const page of [ann, bob])
        await expect.poll(async () => (await cells(page))[1]?.[0]).toBe("=sheet2!a1*2");
      await expect.poll(() => shown(bob, 1, 0)).toBe("10");
      await edit(ann, 0, 0, "6");
      await expect.poll(() => shown(bob, 1, 0)).toBe("12");
      // Bob follows Ann to the second tab: her caret shows again.
      await bob.locator(`[data-testid="sheet-tab"][data-sheet-id="${second}"]`).click();
      await expect(peerCursor(bob, "Ann")).toHaveCount(1);
    });

    await test.step("per-user undo across tabs: Ann's undo switches back to her last step's tab", async () => {
      // Ann's steps, newest first: "6" and "5" on tab 2, the new sheet, then on tab 1 her row
      // move, the Kaas formula and "Peren". Bob's edits (aantal 7, 3.5, the =sheet2 formula) are not.
      await click(ann, 2, 2);
      await ann.keyboard.press(`${MOD}+z`); // 6 → 5
      await ann.keyboard.press(`${MOD}+z`); // 5 → empty
      await expect.poll(async () => (await cells(bob, second))[0]?.[0]).toBe("");
      await ann.keyboard.press(`${MOD}+z`); // the sheet itself (add-sheet was her step)
      // That step belongs to tab 1: the workbook switches there and the new grid takes focus,
      // so the keyboard keeps undoing.
      await expect(bob.getByTestId("sheet-tab")).toHaveCount(1);
      await expect(ann.getByTestId("focus-cell")).toBeFocused();
      await ann.keyboard.press(`${MOD}+z`); // her row move: Brood back to row 2 (no peer moved it since)
      await ann.keyboard.press(`${MOD}+z`); // the Kaas formula
      await ann.keyboard.press(`${MOD}+z`); // Peren → Appels
      for (const page of [ann, bob]) {
        await expect
          .poll(async () => (await cells(page)).map((row) => row[0]))
          .toEqual(["Appels", "Brood", "=#REF!*2", "Wijn"]);
        // Bob's edits in the moved row stay; Bob's cross-sheet formula lost its sheet.
        await expect
          .poll(async () => (await cells(page))[1])
          .toEqual(["Brood", "7", "3.5", "=aantal*prijs"]);
        await expect.poll(async () => (await cells(page))[2]?.[3]).toBe("=aantal*prijs");
      }
    });

    await test.step("server document half is canonical YCSV, with a Yjs sidecar", async () => {
      await ann.getByTestId("save-now").click();
      await expect
        .poll(async () => readDoc(OWNER, apiPath), { timeout: 30_000 })
        .toContain("Appels,6,0.5,=aantal*prijs");
      const stored = (await readDoc(OWNER, apiPath)) ?? "";
      expect(stored.startsWith("---\nycsv_version: 1\n")).toBe(true);
      expect(stored).toContain("Brood,7,3.5,=aantal*prijs");
      expect(stored).not.toMatch(/@r_|s_[a-z0-9]{8}!/); // never the id form
      const sidecar = await readDoc(OWNER, `/groups/team/.${name}.yjs`);
      expect(sidecar).not.toBeNull();
    });

    const expected = await ann.evaluate(() => window.__spike!.serialize());
    await ann.context().close();
    await bob.context().close();

    await test.step("a cold browser reopens the workbook from the server save", async () => {
      const cold = await open(browser, TEAMMATE, "Cleo", file);
      await expect
        .poll(() => cold.evaluate(() => window.__spike!.serialize()), { timeout: 30_000 })
        .toBe(expected);
      await cold.context().close();
    });
  } finally {
    await removeQuietly(OWNER, [apiPath]);
  }
});
