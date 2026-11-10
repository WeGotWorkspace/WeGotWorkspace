import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "./helpers/live-test";
import { openExportDoc } from "./helpers/docs-export-live";

/** Optional: where to keep the printed PDF for a manual or `pdftotext` check. */
const OUT_DIR = process.env.WGW_E2E_DOWNLOAD_DIR;

/** Enough text for a second page, so page breaks are part of the check. */
const LONG_TAIL = Array.from(
  { length: 40 },
  (_, index) =>
    `\nParagraph ${index + 1}: the terms of this quote apply to every item listed above.\n`,
).join("");

type PrintSnapshot = { theme: string | undefined; printing: boolean; imagesReady: boolean };

declare global {
  interface Window {
    __printSnapshots?: PrintSnapshot[];
  }
}

/** Replaces the print dialog: records what the page looked like when it would open. */
async function stubPrint(page: Page) {
  await page.addInitScript(() => {
    window.__printSnapshots = [];
    window.print = () => {
      const images = [...document.querySelectorAll<HTMLImageElement>(".ProseMirror img")];
      window.__printSnapshots?.push({
        theme: document.documentElement.dataset.theme,
        printing: document.body.classList.contains("text-editor-print-active"),
        imagesReady:
          images.length > 0 && images.every((img) => img.complete && img.naturalWidth > 0),
      });
    };
  });
}

async function printSnapshots(page: Page): Promise<PrintSnapshot[]> {
  return page.evaluate(() => window.__printSnapshots ?? []);
}

/** Select `word` in the editor, so typing replaces it. */
async function selectWord(page: Page, word: string): Promise<void> {
  await page.locator(".ProseMirror").click();
  await page.evaluate((target) => {
    const root = document.querySelector(".ProseMirror");
    const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const index = node.textContent?.indexOf(target) ?? -1;
      if (index < 0) continue;
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + target.length);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return;
    }
    throw new Error(`"${target}" not found`);
  }, word);
}

/** Chromium writes one uncompressed `/Type /Page` object per page. */
function pdfPageCount(bytes: Buffer): number {
  return (bytes.toString("latin1").match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
}

test.describe("Docs: Print (live app)", () => {
  test("prints a dark-mode Doc on white paper, with its image, no comment marks and suggestions accepted", async ({
    page,
  }) => {
    await stubPrint(page);
    await page.emulateMedia({ colorScheme: "dark" });
    const { baseName } = await openExportDoc(page, "e2e-print", LONG_TAIL);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    // A comment on "Prices".
    await selectWord(page, "Prices");
    await page.getByRole("button", { name: "Comment", exact: true }).first().click();
    const composer = page.getByPlaceholder("Add a comment…");
    await composer.fill("Check these numbers");
    await composer.press("Enter");
    const commentMark = page.locator(".ProseMirror .comment-mark");
    await expect(commentMark).toContainText("Prices", { timeout: 15_000 });
    // On screen the comment is highlighted; in print it is not (checked below).
    expect(await commentMark.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(
      "rgba(0, 0, 0, 0)",
    );

    // A pending suggestion: "Closing" replaced by "Final".
    const suggest = page.locator(".docs-collab-suggest-controls");
    await suggest.click();
    await expect(suggest).toHaveAttribute("aria-pressed", "true");
    await selectWord(page, "Closing");
    await page.keyboard.type("Final");
    await expect(page.locator(".ProseMirror del[data-change-id]")).toContainText("Closing");
    await expect(page.locator(".ProseMirror ins[data-change-id]")).toContainText("Final");

    await page
      .locator(".docs-workspace__header-actions-row")
      .getByRole("button", { name: "Share" })
      .click();
    await page.getByRole("menuitem", { name: "Print" }).click();

    await expect.poll(async () => (await printSnapshots(page)).length).toBe(1);
    const [snapshot] = await printSnapshots(page);
    expect(snapshot.printing).toBe(true);
    // Paper is white: the page prints in the light theme.
    expect(snapshot.theme).toBe("light");
    expect(snapshot.imagesReady).toBe(true);

    // The print layout as the browser would print it.
    await page.emulateMedia({ media: "print", colorScheme: "dark" });
    const styles = await page.evaluate(() => {
      const style = (selector: string) => {
        const el = document.querySelector(selector);
        if (!el) throw new Error(`${selector} missing`);
        return getComputedStyle(el);
      };
      // Browsers report modern colour spaces (oklch); draw it to read plain RGB.
      const rgb = (color: string) => {
        const ctx = document.createElement("canvas").getContext("2d");
        if (!ctx) throw new Error("no canvas");
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 1, 1);
        return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3));
      };
      const inserted = style(".ProseMirror ins[data-change-id]");
      const comment = style(".ProseMirror .comment-mark");
      return {
        headingBreakAfter: style(".ProseMirror h2").breakAfter,
        imageBreakInside: style(".ProseMirror img").breakInside,
        deletedDisplay: style(".ProseMirror del[data-change-id]").display,
        insertedBackground: inserted.backgroundColor,
        insertedDecoration: inserted.textDecorationLine,
        commentBackground: comment.backgroundColor,
        commentBorder: comment.borderBottomStyle,
        textRgb: rgb(style(".ProseMirror p").color),
      };
    });
    expect(styles.headingBreakAfter).toBe("avoid");
    expect(styles.imageBreakInside).toBe("avoid");
    expect(styles.deletedDisplay).toBe("none");
    expect(styles.insertedBackground).toBe("rgba(0, 0, 0, 0)");
    expect(styles.insertedDecoration).toBe("none");
    expect(styles.commentBackground).toBe("rgba(0, 0, 0, 0)");
    expect(styles.commentBorder).toBe("none");
    // Dark text, not dark mode's light grey.
    expect(Math.max(...styles.textRgb)).toBeLessThan(100);

    const pdf = await page.pdf({ preferCSSPageSize: true });
    expect(pdfPageCount(pdf)).toBeGreaterThan(1);
    if (OUT_DIR) {
      await mkdir(OUT_DIR, { recursive: true });
      await writeFile(path.join(OUT_DIR, `${baseName}.pdf`), pdf);
    }
    await page.emulateMedia({ media: null, colorScheme: "dark" });

    // Closing the print window puts the app back in dark mode.
    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("body")).not.toHaveClass(/text-editor-print-active/);
  });
});
