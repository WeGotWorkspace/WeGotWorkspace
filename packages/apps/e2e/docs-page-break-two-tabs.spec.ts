import { expect, test, type Page } from "./helpers/live-test";
import {
  docsUrlForFile,
  loginToDocs,
  myDriveDocSearchPath,
  seedDocAtPath,
  waitForDocSaved,
} from "./helpers/docs-live";

const A5_WIDTH_PX = 559;

async function openDoc(page: Page, apiPath: string): Promise<void> {
  await page.goto(docsUrlForFile(apiPath));
  await expect(page.locator(".ProseMirror")).toContainText("Second paragraph.", {
    timeout: 30_000,
  });
  await expect(page.locator('[data-connectivity="online"]')).toBeVisible();
}

function pagedEditor(page: Page) {
  return page.locator(".ProseMirror.rm-with-pagination");
}

/** Click a paragraph and wait until the editor has the caret there (it lags the click a frame). */
async function caretAtEndOf(page: Page, text: string): Promise<void> {
  await page.locator(".ProseMirror p", { hasText: text }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        // Tiptap puts the editor on its root element.
        const root = document.querySelector(".ProseMirror") as
          | (HTMLElement & {
              editor?: { state: { selection: { $from: { parent: { textContent: string } } } } };
            })
          | null;
        return root?.editor?.state.selection.$from.parent.textContent ?? null;
      }),
    )
    .toBe(text);
  await page.keyboard.press("End");
}

async function pageWidth(page: Page): Promise<number> {
  return pagedEditor(page).evaluate((element) => Math.round(element.getBoundingClientRect().width));
}

test.describe("Docs pages and page break (live app)", () => {
  test("page setup follows across tabs; a page break reaches the other tab and the file", async ({
    browser,
  }) => {
    const token = `e2e-after-break-${Date.now()}`;
    const fileName = `e2e-page-break-${Date.now()}.md`;
    const apiPath = `/${myDriveDocSearchPath(fileName)}`;
    const context = await browser.newContext({
      storageState: "e2e/.auth/admin.json",
      viewport: { width: 1440, height: 900 },
    });
    const tabA = await context.newPage();
    const tabB = await context.newPage();

    try {
      await loginToDocs(tabA);
      await seedDocAtPath(apiPath, "# Page break\n\nFirst paragraph.\n\nSecond paragraph.\n");
      await openDoc(tabA, apiPath);
      await openDoc(tabB, apiPath);
      await expect(pagedEditor(tabB)).toBeVisible();

      // Page setup is per device: a change in tab A shows in tab B, not in the file.
      await tabA.getByRole("button", { name: "Page setup" }).click();
      await tabA.getByRole("menuitem", { name: "A5" }).click();
      await expect.poll(() => pageWidth(tabA)).toBe(A5_WIDTH_PX);
      await expect.poll(() => pageWidth(tabB)).toBe(A5_WIDTH_PX);

      // Tab A: page break after the first paragraph, then text after it.
      await caretAtEndOf(tabA, "First paragraph.");
      await tabA.keyboard.press("Enter");
      await tabA.keyboard.type("/page");
      await expect(tabA.getByText("Start a new page")).toBeVisible();
      await tabA.keyboard.press("Enter");
      await tabA.keyboard.type(token);

      const breakThenToken = (page: Page) =>
        expect(
          page.locator('.ProseMirror > [data-type="page-break"] + p', { hasText: token }),
        ).toBeVisible({ timeout: 30_000 });
      await breakThenToken(tabA);
      await breakThenToken(tabB);

      await waitForDocSaved(tabA, apiPath, `<!-- pagebreak -->\n\n${token}\n\nSecond paragraph.`);
      expect(await tabA.evaluate(() => localStorage.getItem("wgw.ui.docs.pageSetup"))).toContain(
        '"format":"a5"',
      );

      await tabB.reload();
      await expect(tabB.locator(".ProseMirror")).toContainText(token, { timeout: 30_000 });
      await breakThenToken(tabB);
      await expect.poll(() => pageWidth(tabB)).toBe(A5_WIDTH_PX);
    } finally {
      await context.close();
    }
  });
});
