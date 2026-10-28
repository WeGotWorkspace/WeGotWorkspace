import { expect, test } from "@playwright/test";
import {
  docsUrlForFile,
  loginToDocs,
  myDriveDocSearchPath,
  waitForDocSaved,
} from "./helpers/docs-live";
import { uploadMarkdown } from "./helpers/rtc-chaos";

const ORIGINAL = "Upload test\nThe text from the upload.";
const TYPED = "Typed over all of it";
const KEPT = "The text from the upload.";

async function storedContent(page: import("@playwright/test").Page, apiPath: string) {
  return page.evaluate(async (path) => {
    const accessToken = localStorage.getItem("wgw.api.access_token");
    const response = await fetch(`/api/v1/files/content?path=${encodeURIComponent(path)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return response.ok ? await response.text() : "";
  }, apiPath);
}

test.describe("Docs collab outside write (live app)", () => {
  test("re-uploading the original text after editing it away restores it, once", async ({
    page,
  }) => {
    const fileName = `e2e-reupload-${Date.now()}.md`;
    const apiPath = `/${myDriveDocSearchPath(fileName)}`;

    await uploadMarkdown(apiPath, ORIGINAL);
    await loginToDocs(page);
    await page.goto(docsUrlForFile(apiPath));
    const editor = page.locator(".ProseMirror");
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await expect(editor).toContainText(KEPT, { timeout: 30_000 });

    await editor.click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type(TYPED);
    await waitForDocSaved(page, apiPath, TYPED);

    await uploadMarkdown(apiPath, ORIGINAL);
    await page.reload();

    const reloaded = page.locator(".ProseMirror");
    await expect(reloaded).toBeVisible({ timeout: 30_000 });
    await expect(reloaded).toContainText(KEPT, { timeout: 30_000 });
    await expect(reloaded).not.toContainText(TYPED);

    // Let the autosave settle; the file must not be emptied.
    await page.waitForTimeout(5_000);
    expect(await storedContent(page, apiPath)).toContain(KEPT);

    const second = await page.context().newPage();
    await second.goto(docsUrlForFile(apiPath));
    const secondEditor = second.locator(".ProseMirror");
    await expect(secondEditor).toContainText(KEPT, { timeout: 30_000 });
    expect(
      ((await secondEditor.innerText()).match(/The text from the upload\./g) ?? []).length,
    ).toBe(1);
    await second.close();
  });
});
