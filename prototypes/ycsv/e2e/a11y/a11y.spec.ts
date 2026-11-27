import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { cell, clickCell, MOD, nameBox, rawAt } from "../helpers";
import { cdp, focusInfo } from "./ax";

/**
 * Spike 8 — screen reader accessibility of the Sheets grid.
 *
 * These tests cannot hear a screen reader. They check what the browser hands to one:
 * Chromium's computed accessibility tree (the source for NVDA, JAWS and VoiceOver in Chrome),
 * the polite live region, axe-core rules, and the DOM invariants windowing must keep.
 * RECORD=1 writes transcripts to docs/spike-8-a11y/.
 */

const RECORD = !!process.env.RECORD;
const OUT = "docs/spike-8-a11y";
const story = (id: string) => `/iframe.html?id=spike-6-cell-ux--${id}&viewMode=story`;

async function openStory(page: Page, id: string, args = "") {
  await page.goto(story(id) + (args ? `&args=${args}` : ""));
  await expect(page.getByTestId("grid").first()).toBeVisible();
  await page.waitForFunction(() => !!window.__sheet);
}

async function liveText(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="live-a"], [data-testid="live-b"]')].map((n) => n.textContent ?? "").join(""),
  );
}

/** Every polite-region text that appears from now on (MutationObserver), to count announcements. */
async function recordLive(page: Page, root = 0) {
  await page.evaluate((root) => {
    const w = window as unknown as { __live: string[] };
    w.__live = [];
    const scope = document.querySelectorAll(".sx-root")[root]!;
    for (const n of scope.querySelectorAll('[data-testid="live-a"], [data-testid="live-b"]')) {
      // One entry per text a region receives (what a screen reader would be handed).
      new MutationObserver(() => {
        const t = n.textContent ?? "";
        if (t) w.__live.push(t);
      }).observe(n, { childList: true, characterData: true, subtree: true });
    }
  }, root);
}
const lives = (page: Page) => page.evaluate(() => (window as unknown as { __live: string[] }).__live);

/** What the focused grid position exposes: Chromium AX node + the header cells that share its index. */
async function exposed(page: Page, session: Awaited<ReturnType<typeof cdp>>) {
  const f = await focusInfo(session);
  const node = f.active ?? f.focused;
  const dom = await page.evaluate(() => {
    const focused = document.activeElement as HTMLElement | null;
    const ad = focused?.getAttribute("aria-activedescendant");
    const el = (ad ? document.getElementById(ad) : focused) as HTMLElement | null;
    if (!el || el.getAttribute("role") !== "gridcell") return null;
    const grid = el.closest('[role="grid"]')!;
    const ci = el.getAttribute("aria-colindex");
    const head = grid.querySelector(`[role="columnheader"][aria-colindex="${ci}"]`);
    const row = el.closest('[role="row"]')!;
    // DOM position of the cell in its row vs. the header in the header row: browsers pair them by position.
    const pos = [...row.children].filter((c) => c.getAttribute("role")).indexOf(el);
    const headRow = grid.querySelector('[role="row"][aria-rowindex="1"]')!;
    const headAtPos = [...headRow.children].filter((c) => c.getAttribute("role"))[pos];
    return {
      header: head?.getAttribute("aria-label") ?? head?.textContent ?? "",
      headerByPosition: headAtPos?.getAttribute("aria-label") ?? headAtPos?.textContent ?? "",
      rowHeader: row.querySelector('[role="rowheader"]')?.textContent ?? "",
      rowindex: row.getAttribute("aria-rowindex"),
      colindex: ci,
      describedBy: el.getAttribute("aria-describedby") ? document.getElementById(el.getAttribute("aria-describedby")!)?.textContent ?? "" : "",
    };
  });
  return {
    focusedRole: f.focused?.role ?? "",
    focusedName: f.focused?.name ?? "",
    role: node?.role ?? "",
    name: node?.name ?? "",
    description: node?.description ?? "",
    selected: node?.props.selected,
    editable: f.focused?.props.editable,
    ...dom,
  };
}

const STEPS: { key: string; note: string }[] = [
  { key: "", note: "start on Product row 1" },
  { key: "ArrowRight", note: "next column" },
  { key: "ArrowRight", note: "currency column" },
  { key: "ArrowRight", note: "formula cell" },
  { key: "ArrowDown", note: "down one row" },
  { key: `${MOD}+ArrowDown`, note: "jump to data edge" },
  { key: "ArrowLeft", note: "blank cell" },
  { key: "ArrowLeft", note: "error cell (#REF!)" },
  { key: "Shift+ArrowLeft", note: "extend selection" },
  { key: "Shift+ArrowUp", note: "extend selection" },
  { key: "Enter", note: "edit mode on" },
  { key: "Escape", note: "edit cancelled" },
];

for (const model of ["cell", "descendant"] as const) {
  test(`transcript of what Chromium exposes while moving (${model} focus model)`, async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "CDP accessibility tree");
    await openStory(page, "grid", `focusModel:${model}`);
    await page.bringToFront();
    await clickCell(page, 0, 0);
    const session = await cdp(page);
    const lines: string[] = [];
    const rows: Awaited<ReturnType<typeof exposed>>[] = [];
    for (const step of STEPS) {
      if (step.key) await page.keyboard.press(step.key);
      await page.waitForTimeout(350); // debounce of the selection announcement
      const x = await exposed(page, session);
      rows.push(x);
      const live = await liveText(page);
      lines.push(
        `| ${step.key || "—"} | ${step.note} | ${x.focusedRole} "${x.focusedName}" | ${x.role} "${x.name}"${x.description ? ` — ${x.description}` : ""} | ${x.header ?? ""} | ${x.rowHeader ?? ""} (aria-rowindex ${x.rowindex ?? ""}) | ${live} |`,
      );
    }
    // Header pairing by DOM position must equal pairing by aria-colindex at every step.
    for (const x of rows) if (x.header) expect(x.headerByPosition).toBe(x.header);
    if (model === "cell") {
      // Real DOM focus is on the gridcell (no aria-activedescendant needed).
      expect(rows[0]!.focusedRole).toBe("gridcell");
      expect(rows[3]!.description).toContain("Formula =aantal*prijs*(1+btw)");
      expect(rows[5]!.name).toBe("circular reference error");
      expect(rows[5]!.description).toContain("depends on itself");
      expect(rows[7]!.name).toBe("reference error");
    } else {
      expect(rows[0]!.focusedRole).toBe("textbox");
      expect(rows[0]!.role).toBe("gridcell");
    }
    if (RECORD) {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(
        `${OUT}/ax-transcript-${model}.md`,
        [
          `# What Chromium exposes per keystroke (${model} focus model)`,
          "",
          "Recorded by `e2e/a11y/a11y.spec.ts` (RECORD=1). Focused = the node with DOM focus; Position = the gridcell a screen reader treats as current (the focused cell, or the aria-activedescendant target).",
          "",
          "| Key | Step | Focused | Position (role, name — description) | Column header | Row header | Live region |",
          "|---|---|---|---|---|---|---|",
          ...lines,
          "",
        ].join("\n"),
      );
    }
  });
}

test.describe("axe-core (WCAG 2.2 A/AA)", () => {
  const scan = async (page: Page, label: string) => {
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]).analyze();
    const v = result.violations.map((x) => `${x.id} (${x.impact}): ${x.nodes.length} node(s) — ${x.nodes[0]?.target.join(" ")}`);
    if (RECORD) {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(`${OUT}/axe-${label}.json`, JSON.stringify({ violations: result.violations.map((x) => ({ id: x.id, impact: x.impact, nodes: x.nodes.length, help: x.help })), passes: result.passes.length, incomplete: result.incomplete.map((x) => x.id) }, null, 2));
    }
    return v;
  };

  for (const model of ["cell", "descendant"] as const) {
    test(`navigation, edit + autocomplete, menu, dialog (${model})`, async ({ page }) => {
      await openStory(page, "grid", `focusModel:${model}`);
      await clickCell(page, 1, 1);
      expect(await scan(page, `${model}-nav`)).toEqual([]);
      await page.keyboard.type("=SU");
      await expect(page.getByTestId("autocomplete")).toBeVisible();
      expect(await scan(page, `${model}-autocomplete`)).toEqual([]);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await page.keyboard.press("Shift+F10");
      await expect(page.getByRole("menu")).toBeVisible();
      expect(await scan(page, `${model}-menu`)).toEqual([]);
      await page.getByRole("menuitem", { name: "Column width…" }).click();
      await expect(page.getByTestId("width-dialog")).toBeVisible();
      expect(await scan(page, `${model}-dialog`)).toEqual([]);
    });
  }

  test("two users with peer carets and labels (cell)", async ({ page }) => {
    await page.goto(story("a-11-y-two-users"));
    await page.waitForFunction(() => !!window.__sheetB);
    await page.waitForTimeout(1800); // Chris has moved at least once
    expect(await scan(page, "cell-two-users")).toEqual([]);
  });

  test("rows and columns windowed, scrolled to the middle (cell)", async ({ page }) => {
    await openStory(page, "a-11-y-wide");
    await page.getByTestId("grid").evaluate((el) => {
      el.scrollTop = 140_000;
      el.scrollLeft = 1_500;
    });
    await page.waitForTimeout(100);
    expect(await scan(page, "cell-wide")).toEqual([]);
  });
});

test.describe("windowing keeps the table model and focus intact", () => {
  for (const id of ["a-11-y-wide", "a-11-y-wide-descendant"]) {
    test(`same column set in every rendered row; active cell survives scrolling away (${id})`, async ({ page }) => {
      await openStory(page, id);
      await clickCell(page, 0, 0);
      const grid = page.getByTestId("grid");
      // 30 columns × 10 000 rows: only a window of each is in the DOM.
      const domCols = await page.locator('[role="row"][aria-rowindex="1"] [role="columnheader"]').count();
      expect(domCols).toBeLessThan(20);
      await expect(grid).toHaveAttribute("aria-colcount", "31");
      await expect(grid).toHaveAttribute("aria-rowcount", "10001");

      // Scroll far right and down with the wheel: the active cell (row 1, col 1) is off screen.
      await grid.evaluate((el) => {
        el.scrollLeft = 2_400;
        el.scrollTop = 100_000;
      });
      await page.waitForTimeout(150);
      const shape = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('[role="grid"] [role="row"]')];
        return rows.map((r) => [...r.querySelectorAll('[role="gridcell"], [role="columnheader"], [role="rowheader"]')].map((c) => c.getAttribute("aria-colindex")).join(","));
      });
      expect(new Set(shape).size).toBe(1); // header row and every body row: identical column sets
      expect(shape[0]!.split(",")[1]).toBe("2"); // the active column stays first, then the window
      // Focus did not fall to <body>; the active cell is still the focus target / descendant.
      const active = await page.evaluate(() => {
        const a = document.activeElement as HTMLElement;
        const id = a.getAttribute("aria-activedescendant") ?? a.id;
        const el = document.getElementById(id);
        return { tag: a.tagName, role: el?.getAttribute("role"), id };
      });
      expect(active.role).toBe("gridcell");
      expect(active.id).toMatch(/-cell-0-0$/);
      // Keyboard brings it back into view.
      await page.keyboard.press("ArrowDown");
      expect(await nameBox(page)).toBe("k12");
      const box = await cell(page, 1, 0).boundingBox();
      expect(box && box.y > 0 && box.y < 700).toBeTruthy();
    });
  }
});

test.describe("announcements (cell focus model)", () => {
  test.beforeEach(async ({ page }) => {
    await openStory(page, "a-11-y-cell");
    await clickCell(page, 0, 0);
    await recordLive(page);
  });

  test("range size, edit cancel, clear, undo — and nothing on plain moves", async ({ page }) => {
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(400);
    expect(await lives(page)).toEqual([]); // focus speaks for single-cell moves
    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("Shift+ArrowDown");
    await page.waitForTimeout(400);
    // One line for the whole Shift burst (debounced), with the sum of the numbers.
    expect(await lives(page)).toEqual(["Aantal row 2 to Totaal row 3 selected, 2 rows by 3 columns, sum 23.1708"]);
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Delete");
    await page.keyboard.press(`${MOD}+z`);
    await page.waitForTimeout(400);
    expect((await lives(page)).slice(1)).toEqual(["Edit cancelled", "Cleared 1 cell", "Undone"]);
  });

  test("type-to-replace, IME and dead-key compositions land in the focused cell", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "CDP input");
    const s = await page.context().newCDPSession(page);
    // Japanese IME: composition starts while the gridcell (not an input) has focus.
    await s.send("Input.imeSetComposition", { text: "にほ", selectionStart: 2, selectionEnd: 2 });
    await s.send("Input.insertText", { text: "日本" });
    await expect(page.getByTestId("cell-input")).toHaveValue("日本");
    await page.keyboard.type("語");
    await page.keyboard.press("Enter");
    expect(await rawAt(page, 0, 0)).toBe("日本語");
    // Dead key (´ then e) on the next cell.
    await s.send("Input.imeSetComposition", { text: "´", selectionStart: 1, selectionEnd: 1 });
    await s.send("Input.insertText", { text: "é" });
    await page.keyboard.type("én");
    await page.keyboard.press("Enter");
    expect(await rawAt(page, 1, 0)).toBe("één");
    // Plain typing.
    await page.keyboard.type("Kaas2");
    await page.keyboard.press("Enter");
    expect(await rawAt(page, 2, 0)).toBe("Kaas2");
  });

  test("keyboard routes for mouse-only actions: move rows, fill series, width, go to, F6", async ({ page }) => {
    // Move row 2 up with ⌥⇧↑.
    await clickCell(page, 1, 0);
    await page.keyboard.press("Alt+Shift+ArrowUp");
    expect(await rawAt(page, 0, 0)).toBe("Brood");
    // Fill series from the menu: aantal 6,2 … select aantal1:aantal4 after clearing 3 and 4.
    await clickCell(page, 2, 1);
    await page.keyboard.press("Shift+ArrowDown");
    await page.keyboard.press("Delete");
    await clickCell(page, 0, 1);
    await page.keyboard.press("Shift+ArrowDown");
    await page.keyboard.press("Shift+ArrowDown");
    await page.keyboard.press("Shift+ArrowDown");
    await page.keyboard.press("Shift+F10");
    await page.getByRole("menuitem", { name: "Fill series down" }).press("Enter");
    expect((await page.evaluate(() => window.__sheet!.cells())).slice(0, 4).map((r) => r[1])).toEqual(["2", "6", "10", "14"]);
    // Column width dialog.
    await page.keyboard.press("Shift+F10");
    await page.getByRole("menuitem", { name: "Column width…" }).press("Enter");
    const dialog = page.getByRole("dialog", { name: "Width of column Aantal" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press(`${process.platform === "darwin" ? "Meta" : "Control"}+a`);
    await page.keyboard.type("200");
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    expect(Math.round((await cell(page, 0, 1).boundingBox())!.width)).toBe(200);
    await expect(page.getByTestId("focus-cell")).toBeFocused();
    // Go to with Ctrl+G.
    await page.keyboard.press("Control+g");
    await expect(page.getByTestId("namebox")).toBeFocused();
    await page.keyboard.type("prijs5");
    await page.keyboard.press("Enter");
    expect(await nameBox(page)).toBe("prijs5");
    await expect(page.getByTestId("focus-cell")).toBeFocused();
    // F6 leaves the grid (Tab moves between cells), Escape comes back.
    await page.keyboard.press("F6");
    await expect(page.getByTestId("namebox")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("focus-cell")).toBeFocused();
    const said = await lives(page);
    expect(said).toContain("Moved to row 1");
    expect(said).toContain("Filled 2 cells");
    expect(said).toContain("Width set to 200 pixels");
  });
});

test.describe("remote changes and peers (two users, cell focus model)", () => {
  test("a peer editing my cell is announced; a burst elsewhere becomes one line; carets are silent", async ({ page }) => {
    await page.goto(story("a-11-y-two-users"));
    await page.waitForFunction(() => !!window.__sheetB);
    const left = page.getByTestId("grid").first();
    const box = (await left.locator('[role="gridcell"][id$="-cell-0-0"]').boundingBox())!;
    await page.mouse.click(box.x + 20, box.y + 10); // Anna on product1
    await recordLive(page);
    // Chris (awareness only) keeps wandering every 1.6 s: watch for 3.5 s, nothing may be said about it.
    await page.waitForTimeout(3500);
    expect((await lives(page)).filter((t) => !t.includes("joined"))).toEqual([]);

    // Ben changes the cell Anna is on.
    await page.evaluate(() => window.__sheetB!.setCell(0, 0, "Peren"));
    await expect.poll(() => lives(page)).toContain("Ben changed this cell to Peren");

    // Ben pastes 40 cells elsewhere in 40 separate transactions.
    await page.evaluate(() => {
      for (let i = 0; i < 40; i += 1) window.__sheetB!.setCell(i, 5, `n${i}`);
    });
    await page.waitForTimeout(2500);
    const said = await lives(page);
    const burst = said.filter((t) => t.startsWith("Ben edited"));
    expect(burst).toEqual(["Ben edited 40 cells"]);

    // "Where is everyone?" on demand.
    await page.keyboard.press("Alt+Shift+KeyP");
    await expect.poll(() => liveText(page)).toContain("Ben is on Product row 1");
    expect(await liveText(page)).toMatch(/Chris is on .+ row \d/);
    if (RECORD) writeFileSync(`${OUT}/live-two-users.json`, JSON.stringify(await lives(page), null, 2));
  });
});

test("Playwright aria snapshot of the windowed grid (cell model)", async ({ page }) => {
  await openStory(page, "a-11-y-wide");
  await clickCell(page, 0, 0);
  await page.keyboard.press("ArrowRight");
  const snap = await page.getByTestId("grid").ariaSnapshot();
  expect(snap).toContain('columnheader "Kolom 2, ref k2"');
  if (RECORD) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}/aria-snapshot-wide.yaml`, snap.split("\n").slice(0, 60).join("\n") + "\n# … (truncated)\n");
  }
});

test("tab order: sheet ⇄ name box ⇄ formula bar without starting an edit", async ({ page }) => {
  await openStory(page, "grid", "focusModel:cell;autoFocus:!true");
  await expect(page.getByTestId("focus-cell")).toBeFocused();
  await page.keyboard.press("F6");
  await expect(page.getByTestId("namebox")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("formula-bar")).toBeFocused();
  await expect(page.getByTestId("edit-mode")).toHaveCount(0); // tabbing through does not edit
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("focus-cell")).toBeFocused();
  // Shift+Tab from the sheet goes back to the toolbar (no trap): the grid is one tab stop.
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByTestId("focus-cell")).toBeFocused(); // Tab/Shift+Tab move between cells…
  expect(await nameBox(page)).toBe("product1"); // …and at A1 Shift+Tab stays: F6 is the way out (documented)
});

test("assistive-tech activation (bare click, no pointer events) selects, and again edits", async ({ page }) => {
  await openStory(page, "a-11-y-cell");
  await clickCell(page, 0, 0);
  await page.waitForTimeout(1100); // outside the pointer window
  // What VoiceOver (iOS double-tap) and NVDA's default action send: element.click() only.
  await cell(page, 2, 1).evaluate((el) => (el as HTMLElement).click());
  expect(await nameBox(page)).toBe("aantal3");
  await expect(page.getByTestId("focus-cell")).toBeFocused();
  await cell(page, 2, 1).evaluate((el) => (el as HTMLElement).click());
  await expect(page.getByTestId("edit-mode")).toHaveText("Edit");
  await page.keyboard.press("Escape");
  await page.locator('[role="columnheader"][aria-colindex="4"]').evaluate((el) => (el as HTMLElement).click());
  expect(await nameBox(page)).toBe("prijs1:prijs6");
});
