import { expect, test, type Page } from "@playwright/test";
import {
  docsUrlForFile,
  loginToDocs,
  myDriveDocSearchPath,
  seedDocAtPath,
} from "./helpers/docs-live";

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
    throw new Error(`word not found: ${target}`);
  }, word);
}

async function storedContent(page: Page, apiPath: string): Promise<string> {
  return page.evaluate(async (path) => {
    const accessToken = localStorage.getItem("wgw.api.access_token");
    const response = await fetch(`/api/v1/files/content?path=${encodeURIComponent(path)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return response.ok ? await response.text() : "";
  }, apiPath);
}

test.describe("Docs collab suggest + save (live app)", () => {
  test("a save while a suggestion is pending keeps the paragraph for every tab and the file", async ({
    page,
  }) => {
    const stamp = Date.now();
    const fileName = `e2e-suggest-save-${stamp}.md`;
    const apiPath = `/${myDriveDocSearchPath(fileName)}`;

    await loginToDocs(page);
    await seedDocAtPath(page, apiPath, `# ${fileName}\n\nHello old world\n`);

    await page.goto(docsUrlForFile(apiPath));
    const editorA = page.locator(".ProseMirror");
    await expect(editorA).toBeVisible({ timeout: 30_000 });
    await expect(editorA).toContainText("Hello old world");

    const pageB = await page.context().newPage();
    await pageB.goto(docsUrlForFile(apiPath));
    const editorB = pageB.locator(".ProseMirror");
    await expect(editorB).toBeVisible({ timeout: 30_000 });
    await expect(editorB).toContainText("Hello old world");

    await page.locator(".docs-collab-suggest-controls").click();
    await expect(page.locator(".docs-collab-suggest-controls")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await selectWord(page, "old");
    await page.keyboard.type("new");
    await expect(page.locator(".docs-suggestion-card").first()).toBeVisible({ timeout: 15_000 });

    // Let the debounced save (SAVE_DELAY_MS = 2000) run and settle.
    await page.waitForTimeout(6_000);

    for (const editor of [editorA, editorB]) {
      await expect(editor).toContainText("Hello");
      await expect(editor).toContainText("world");
    }
    await expect(editorA).toContainText("new");
    await expect(page.locator(".docs-suggestion-card").first()).toBeVisible();

    await pageB.reload();
    const reloaded = pageB.locator(".ProseMirror");
    await expect(reloaded).toBeVisible({ timeout: 30_000 });
    await expect(reloaded).toContainText("Hello");
    await expect(reloaded).toContainText("world");
    await expect(reloaded).toContainText("new");

    const stored = await storedContent(page, apiPath);
    expect(stored).toContain("Hello old world");
    expect(stored).not.toMatch(/<ins|<del/);
    expect(stored).not.toContain("new");
    await pageB.close();
  });
});
