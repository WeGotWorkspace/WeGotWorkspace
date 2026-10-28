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

/** The JMAP route: upload a blob, then FileNode/set create over the same name. */
async function replaceViaFileNodeSet(
  page: import("@playwright/test").Page,
  fileName: string,
  content: string,
) {
  return page.evaluate(
    async ({ name, body }) => {
      const accessToken = localStorage.getItem("wgw.api.access_token");
      const auth = { Authorization: `Bearer ${accessToken}` };
      const session = await (await fetch("/api/v1/jmap/session", { headers: auth })).json();
      const accountId = session.primaryAccounts["urn:ietf:params:jmap:filenode"];
      const jmap = async (methodCalls: unknown[]) =>
        (
          await fetch("/api/v1/jmap", {
            method: "POST",
            headers: { ...auth, "Content-Type": "application/json" },
            body: JSON.stringify({
              using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:filenode"],
              methodCalls,
            }),
          })
        ).json();
      const all = await jmap([["FileNode/get", { accountId, ids: null }, "c0"]]);
      const existing = all.methodResponses[0][1].list.find(
        (node: { name: string }) => node.name === name,
      );
      const upload = await (
        await fetch(`/api/v1/jmap/upload/${accountId}`, {
          method: "POST",
          headers: { ...auth, "Content-Type": "text/markdown" },
          body,
        })
      ).json();
      const set = await jmap([
        [
          "FileNode/set",
          {
            accountId,
            onExists: "replace",
            create: { f0: { parentId: existing.parentId, name, blobId: upload.blobId } },
          },
          "c1",
        ],
      ]);
      return set.methodResponses[0][1].created?.f0?.name ?? null;
    },
    { name: fileName, body: content },
  );
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

  test("a FileNode/set replace shows the upload in a fresh browser and after a reopen", async ({
    page,
    browser,
  }) => {
    const fileName = `e2e-replace-${Date.now()}.md`;
    const apiPath = `/${myDriveDocSearchPath(fileName)}`;

    await uploadMarkdown(apiPath, ORIGINAL);
    await loginToDocs(page);
    await page.goto(docsUrlForFile(apiPath));
    const editor = page.locator(".ProseMirror");
    await expect(editor).toContainText(KEPT, { timeout: 30_000 });

    await editor.click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type(TYPED);
    await waitForDocSaved(page, apiPath, TYPED);

    expect(await replaceViaFileNodeSet(page, fileName, ORIGINAL)).toBe(fileName);

    // A fresh browser (no IndexedDB) while the first tab still holds the old state.
    const fresh = await browser.newContext({ storageState: await page.context().storageState() });
    const freshPage = await fresh.newPage();
    await freshPage.goto(docsUrlForFile(apiPath));
    const freshEditor = freshPage.locator(".ProseMirror");
    await expect(freshEditor).toContainText(KEPT, { timeout: 30_000 });
    await expect(freshEditor).not.toContainText(TYPED);

    // Reopening the first tab (same IndexedDB) shows the upload too. That the
    // open tab follows the fresh browser's rebuild over the mesh is covered by
    // unit tests: two local contexts here do not form a mesh link.
    await fresh.close();
    await page.reload();
    const reopened = page.locator(".ProseMirror");
    await expect(reopened).toContainText(KEPT, { timeout: 30_000 });
    await expect(reopened).not.toContainText(TYPED);

    await page.waitForTimeout(5_000);
    expect(await storedContent(page, apiPath)).toContain(KEPT);
  });
});
