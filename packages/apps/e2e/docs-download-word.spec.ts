import { mkdir, readFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { expect, test, type Page } from "./helpers/live-test";
import {
  docsUrlForFile,
  loginToDocs,
  myDriveDocSearchPath,
  seedDocAtPath,
} from "./helpers/docs-live";

/** Optional: where to keep the downloaded files for a manual or LibreOffice check. */
const OUT_DIR = process.env.WGW_E2E_DOWNLOAD_DIR;

/** Draw a 480 × 240 PNG in the page, upload it next to the Doc and return its FileNode id. */
async function uploadPngNextTo(page: Page, docName: string, imageName: string): Promise<string> {
  return page.evaluate(
    async ({ docName, imageName }) => {
      const canvas = document.createElement("canvas");
      canvas.width = 480;
      canvas.height = 240;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no canvas");
      ctx.fillStyle = "#1d4ed8";
      ctx.fillRect(0, 0, 480, 240);
      const png = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("toBlob"))), "image/png"),
      );
      const auth = { Authorization: `Bearer ${localStorage.getItem("wgw.api.access_token")}` };
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
      const named = await jmap([
        ["FileNode/query", { accountId, filter: { name: docName } }, "q0"],
        [
          "FileNode/get",
          { accountId, "#ids": { resultOf: "q0", name: "FileNode/query", path: "/ids" } },
          "g0",
        ],
      ]);
      const doc = named.methodResponses[1][1].list.find(
        (node: { name: string }) => node.name === docName,
      );
      const upload = await (
        await fetch(`/api/v1/jmap/upload/${accountId}`, {
          method: "POST",
          headers: { ...auth, "Content-Type": "image/png" },
          body: png,
        })
      ).json();
      const set = await jmap([
        [
          "FileNode/set",
          {
            accountId,
            create: { i0: { parentId: doc.parentId, name: imageName, blobId: upload.blobId } },
          },
          "s0",
        ],
      ]);
      const created = set.methodResponses[0][1].created?.i0;
      if (!created?.id) throw new Error(`image create failed: ${JSON.stringify(set)}`);
      return created.id as string;
    },
    { docName, imageName },
  );
}

function docMarkdown(imageId: string): string {
  return [
    "# Quote for Acme",
    "",
    "Prices below. See [our site](https://example.com) for **terms**.",
    "",
    "## Scope",
    "",
    "- Design",
    "  - Logo",
    "- Build",
    "",
    "1. Kick-off",
    "2. Delivery",
    "",
    "| Item | Price |",
    "| --- | --- |",
    "| Design | 100 |",
    "| Build | 200 |",
    "",
    `![Company logo](drive:${imageId})`,
    "",
    "Closing line.",
    "",
  ].join("\n");
}

async function downloadWord(
  page: Page,
  label: string,
): Promise<{ name: string; bytes: Uint8Array }> {
  const download = page.waitForEvent("download");
  await page
    .locator(".docs-workspace__header-actions-row")
    .getByRole("button", { name: "Download" })
    .click();
  await page.getByRole("menuitem", { name: "Word (.docx)" }).click();
  const file = await download;
  const target = await file.path();
  if (OUT_DIR) {
    await mkdir(OUT_DIR, { recursive: true });
    await copyFile(target, path.join(OUT_DIR, `${label}-${file.suggestedFilename()}`));
  }
  return { name: file.suggestedFilename(), bytes: new Uint8Array(await readFile(target)) };
}

function readDocx(bytes: Uint8Array) {
  const files = unzipSync(bytes);
  const text = (name: string) => (files[name] ? strFromU8(files[name]) : "");
  return {
    document: text("word/document.xml"),
    rels: text("word/_rels/document.xml.rels"),
    media: Object.keys(files).filter((name) => name.startsWith("word/media/")),
  };
}

function expectFullDoc(docx: ReturnType<typeof readDocx>) {
  expect(docx.document).toContain('<w:pStyle w:val="Heading1"/>');
  expect(docx.document).toContain('<w:pStyle w:val="Heading2"/>');
  expect(docx.document).toContain("Quote for Acme");
  expect((docx.document.match(/<w:numPr>/g) ?? []).length).toBe(5);
  expect(docx.document).toContain("<w:tblHeader/>");
  expect(docx.document).toContain("Delivery");
  expect(docx.rels).toContain('Target="https://example.com"');
  expect(docx.media).toHaveLength(1);
  expect(docx.document).toContain('descr="Company logo"');
  expect(docx.document).not.toContain("[Image");
}

test.describe("Docs: download as Word (live app)", () => {
  test("builds a .docx with headings, lists, table, link and the Drive image, also offline", async ({
    page,
    context,
  }) => {
    const stamp = Date.now();
    const fileName = `e2e-export-${stamp}.md`;
    const apiPath = `/${myDriveDocSearchPath(fileName)}`;

    // A helper file in the same folder gives the image its parent; the Doc itself is
    // written once, so no earlier version of it is cached.
    const anchorName = `e2e-export-anchor-${stamp}.txt`;
    await seedDocAtPath(`/${myDriveDocSearchPath(anchorName)}`, "anchor\n");
    await loginToDocs(page);
    const imageId = await uploadPngNextTo(page, anchorName, `e2e-export-logo-${stamp}.png`);
    await seedDocAtPath(apiPath, docMarkdown(imageId));

    await page.goto(docsUrlForFile(apiPath));
    await expect(page.locator(".ProseMirror")).toContainText("Closing line.", { timeout: 30_000 });
    await expect(page.locator(".ProseMirror img[src^='blob:']")).toBeVisible();

    const online = await downloadWord(page, "online");
    expect(online.name).toBe(`e2e-export-${stamp}.docx`);
    expectFullDoc(readDocx(online.bytes));
    const downloadButton = page
      .locator(".docs-workspace__header-actions-row")
      .getByRole("button", { name: "Download" });
    await expect(downloadButton).toBeEnabled();

    // Offline: the image comes from the blob the editor already shows.
    await context.setOffline(true);
    try {
      const offline = await downloadWord(page, "offline");
      expect(offline.name).toBe(`e2e-export-${stamp}.docx`);
      expectFullDoc(readDocx(offline.bytes));
    } finally {
      await context.setOffline(false);
    }
  });
});
