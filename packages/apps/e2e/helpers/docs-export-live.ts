import { expect, type Page } from "./live-test";
import { docsUrlForFile, loginToDocs, myDriveDocSearchPath, seedDocAtPath } from "./docs-live";

/** Draw a 480 × 240 PNG in the page, upload it next to the Doc and return its FileNode id. */
export async function uploadPngNextTo(
  page: Page,
  docName: string,
  imageName: string,
): Promise<string> {
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

/** Headings, nested lists, a table, a link and a Drive image: what both downloads cover. */
export function docMarkdown(imageId: string): string {
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

/**
 * Seeds the export Doc with its Drive image and opens it, image shown. A helper file in
 * the same folder gives the image its parent; the Doc itself is written once, so no
 * earlier version of it is cached.
 */
export async function openExportDoc(
  page: Page,
  prefix: string,
  extraMarkdown = "",
): Promise<{ stamp: number; baseName: string }> {
  const stamp = Date.now();
  const baseName = `${prefix}-${stamp}`;
  const anchorName = `${prefix}-anchor-${stamp}.txt`;
  await seedDocAtPath(`/${myDriveDocSearchPath(anchorName)}`, "anchor\n");
  await loginToDocs(page);
  const imageId = await uploadPngNextTo(page, anchorName, `${prefix}-logo-${stamp}.png`);
  const apiPath = `/${myDriveDocSearchPath(`${baseName}.md`)}`;
  await seedDocAtPath(apiPath, docMarkdown(imageId) + extraMarkdown);
  await page.goto(docsUrlForFile(apiPath));
  await expect(page.locator(".ProseMirror")).toContainText("Closing line.", { timeout: 30_000 });
  await expect(page.locator(".ProseMirror img[src^='blob:']")).toBeVisible();
  return { stamp, baseName };
}
