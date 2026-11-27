import { expect, test } from "@playwright/test";

/**
 * Spike 8: can a focused, non-editable gridcell (roving focus) still receive what a
 * spreadsheet needs? Type-to-replace, clipboard events, IME. Plain HTML, no grid.
 */
const PAGE = `<!doctype html><meta charset="utf-8">
<div role="grid" aria-label="t"><div role="row"><div role="gridcell" id="cell" tabindex="0">Appels</div></div></div>
<input id="ed" style="position:absolute;left:-9999px">
<script>
  window.log = [];
  const cell = document.getElementById('cell'), ed = document.getElementById('ed');
  for (const t of ['copy','cut','paste','beforeinput','input','compositionstart','compositionend'])
    document.addEventListener(t, e => log.push(t + '@' + (e.target.id || e.target.nodeName)), true);
  cell.addEventListener('keydown', e => {
    log.push('keydown:' + e.key);
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) { ed.value=''; ed.focus(); }
  });
</script>`;

test("type-to-replace and clipboard on a focused gridcell", async ({ page, browserName }) => {
  await page.setContent(PAGE);
  await page.focus("#cell");
  await page.keyboard.type("x");
  const typed = await page.inputValue("#ed");
  await page.focus("#cell");
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press(`${mod}+c`);
  await page.keyboard.press(`${mod}+x`);
  await page.keyboard.press(`${mod}+v`);
  const log = await page.evaluate(() => (window as unknown as { log: string[] }).log);
  console.log(browserName, "typed:", JSON.stringify(typed), "log:", log.join(" "));
  expect(typed).toBe("x");
});

test("IME composition starting on a focused gridcell (Chromium CDP)", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "CDP only");
  await page.setContent(PAGE);
  await page.focus("#cell");
  const s = await page.context().newCDPSession(page);
  // What an IME does: composition text arrives while the cell (not editable) has focus.
  await s.send("Input.imeSetComposition", { text: "に", selectionStart: 1, selectionEnd: 1 });
  await s.send("Input.insertText", { text: "日本" });
  const log = await page.evaluate(() => (window as unknown as { log: string[] }).log);
  console.log("ime on cell:", JSON.stringify(await page.inputValue("#ed")), log.join(" "));
  await page.focus("#ed");
  await s.send("Input.imeSetComposition", { text: "に", selectionStart: 1, selectionEnd: 1 });
  await s.send("Input.insertText", { text: "日本" });
  console.log("ime on input:", JSON.stringify(await page.inputValue("#ed")));
});
