import { mkdir, readFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { expect, test, type Page } from "./helpers/live-test";
import { openExportDoc } from "./helpers/docs-export-live";

/** Optional: where to keep the downloaded files for a manual or LibreOffice check. */
const OUT_DIR = process.env.WGW_E2E_DOWNLOAD_DIR;

async function downloadWord(
  page: Page,
  label: string,
): Promise<{ name: string; bytes: Uint8Array }> {
  const download = page.waitForEvent("download");
  await page
    .locator(".docs-workspace__header-actions-row")
    .getByRole("button", { name: "Share" })
    .click();
  await page.getByRole("menuitem", { name: "Download Word (.docx)" }).click();
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
    const { baseName } = await openExportDoc(page, "e2e-export");

    const online = await downloadWord(page, "online");
    expect(online.name).toBe(`${baseName}.docx`);
    expectFullDoc(readDocx(online.bytes));
    const shareButton = page
      .locator(".docs-workspace__header-actions-row")
      .getByRole("button", { name: "Share" });
    await expect(shareButton).toBeEnabled();

    // Offline: the image comes from the blob the editor already shows.
    await context.setOffline(true);
    try {
      const offline = await downloadWord(page, "offline");
      expect(offline.name).toBe(`${baseName}.docx`);
      expectFullDoc(readDocx(offline.bytes));
    } finally {
      await context.setOffline(false);
    }
  });
});
