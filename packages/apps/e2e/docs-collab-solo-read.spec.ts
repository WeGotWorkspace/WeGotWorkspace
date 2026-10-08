import * as Y from "yjs";
import { expect, test } from "@playwright/test";
import {
  docsUrlForFile,
  expectEditorContains,
  loginToDocs,
  myDriveDocSearchPath,
  saveCollabDocument,
  seedDocAtPath,
} from "./helpers/docs-live";

function emptyYjsSidecarBytes(): number[] {
  const doc = new Y.Doc();
  doc.getXmlFragment("default");
  return Array.from(Y.encodeStateAsUpdate(doc));
}

test.describe("Docs collab solo read (live app)", () => {
  test("shows markdown when the Yjs sidecar body is empty, including after reload", async ({
    page,
  }) => {
    const stamp = Date.now();
    const fileName = `e2e-solo-read-${stamp}.md`;
    const apiPath = `/${myDriveDocSearchPath(fileName)}`;
    const token = `solo-read-token-${stamp}`;
    const markdown = `# ${fileName}\n\n${token}\n`;

    await loginToDocs(page);
    await seedDocAtPath(page, apiPath, markdown);
    await saveCollabDocument(page, apiPath, markdown, emptyYjsSidecarBytes());

    await page.goto(docsUrlForFile(apiPath));
    await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 30_000 });
    await expectEditorContains(page, token);

    await page.reload();
    await expect(page.locator(".ProseMirror")).toBeVisible({ timeout: 30_000 });
    await expectEditorContains(page, token);
  });
});
