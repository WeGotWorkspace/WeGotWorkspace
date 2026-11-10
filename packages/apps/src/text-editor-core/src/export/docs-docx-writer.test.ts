/** @vitest-environment jsdom */
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { writeDocx } from "./docs-docx-writer";
import { docsExportPage } from "./docs-download-word";
import { editorJsonToExportBlocks, type ExportBlock } from "./text-editor-export-blocks";
import { createExportFixtureEditor, EXPORT_FIXTURE_IMAGE_SRC } from "./text-editor-export-fixture";
import type { ExportImages } from "./text-editor-export-images";

/** PNG signature plus an IHDR that says 2000 × 1000 px. Enough for the writer. */
function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function fixtureBlocks(): ExportBlock[] {
  const editor = createExportFixtureEditor();
  try {
    return editorJsonToExportBlocks(editor.getJSON());
  } finally {
    editor.destroy();
  }
}

async function unzipDocx(
  blocks: ExportBlock[],
  images: ExportImages = new Map(),
  landscape = false,
) {
  const { blob, missingImages } = await writeDocx(blocks, {
    title: "Quote",
    page: docsExportPage({ format: "a4", orientation: landscape ? "landscape" : "portrait" }),
    images,
  });
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const text = (name: string) => (files[name] ? strFromU8(files[name]) : "");
  return {
    files,
    missingImages,
    document: text("word/document.xml"),
    styles: text("word/styles.xml"),
    numbering: text("word/numbering.xml"),
    rels: text("word/_rels/document.xml.rels"),
    core: text("docProps/core.xml"),
  };
}

const IMAGE: ExportImages = new Map([
  [
    EXPORT_FIXTURE_IMAGE_SRC,
    { bytes: pngHeader(2000, 1000), type: "png", width: 2000, height: 1000 },
  ],
]);

describe("writeDocx", () => {
  it("uses Word's Heading styles with outline levels for the navigation pane", async () => {
    const { document, styles } = await unzipDocx(fixtureBlocks(), IMAGE);
    expect(document).toContain('<w:pStyle w:val="Heading1"/>');
    expect(document).toContain('<w:pStyle w:val="Heading2"/>');
    expect(document).toMatch(/<w:pStyle w:val="Heading1"\/>[\s\S]*?<w:jc w:val="center"\/>/);
    for (let level = 1; level <= 6; level++) {
      const style = styles.match(
        new RegExp(`<w:style[^>]*w:styleId="Heading${level}"[\\s\\S]*?</w:style>`),
      );
      expect(style?.[0]).toContain(`<w:outlineLvl w:val="${level - 1}"/>`);
    }
  });

  it("writes real numbering: one bullet list and ordered lists that start where the Doc does", async () => {
    const { document, numbering } = await unzipDocx(fixtureBlocks(), IMAGE);
    expect((document.match(/<w:numPr>/g) ?? []).length).toBe(5);
    expect(document).toMatch(/<w:ilvl w:val="1"\/>/);
    expect(numbering).toContain('<w:numFmt w:val="bullet"/>');
    expect(numbering).toContain('<w:numFmt w:val="decimal"/>');
    expect(numbering).toContain('<w:start w:val="3"/>');
  });

  it("writes task items as checkbox characters", async () => {
    const { document } = await unzipDocx(fixtureBlocks(), IMAGE);
    expect(document).toContain("☐\t");
    expect(document).toContain("☒\t");
  });

  it("writes a table whose first row is the repeating header row", async () => {
    const { document } = await unzipDocx(fixtureBlocks(), IMAGE);
    const table = document.match(/<w:tbl>[\s\S]*?<\/w:tbl>/)?.[0] ?? "";
    const rows = table.match(/<w:tr>[\s\S]*?<\/w:tr>/g) ?? [];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("<w:tblHeader/>");
    expect(rows[1]).not.toContain("tblHeader");
    expect(rows[0]).toMatch(/<w:b\/>[\s\S]*Item/);
  });

  it("embeds the Drive image capped at the text column", async () => {
    const { document, rels, files, missingImages } = await unzipDocx(fixtureBlocks(), IMAGE);
    expect(missingImages).toBe(0);
    const media = Object.keys(files).filter((name) => name.startsWith("word/media/"));
    expect(media).toHaveLength(1);
    expect(media[0]).toMatch(/\.png$/);
    expect(rels).toContain(
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"',
    );
    // A4 minus two 1 in margins is about 602 px wide; 1 px = 9525 EMU.
    const cx = Number(document.match(/<wp:extent cx="(\d+)" cy="(\d+)"/)?.[1]);
    const cy = Number(document.match(/<wp:extent cx="(\d+)" cy="(\d+)"/)?.[2]);
    expect(Math.round(cx / 9525)).toBe(602);
    expect(Math.round(cy / 9525)).toBe(301);
    expect(document).toContain('descr="Logo"');
  });

  it("writes a placeholder when an image could not be fetched", async () => {
    const { document, files, missingImages } = await unzipDocx(fixtureBlocks(), new Map());
    expect(missingImages).toBe(1);
    expect(document).toContain("[Image: Logo]");
    expect(Object.keys(files).some((name) => name.startsWith("word/media/"))).toBe(false);
  });

  it("links runs, keeps inline formatting and named styles for the Word importer", async () => {
    const { document, rels, styles } = await unzipDocx(fixtureBlocks(), IMAGE);
    expect(rels).toContain('Target="https://example.com"');
    expect(rels).toContain('TargetMode="External"');
    expect(document).toMatch(/<w:hyperlink [^>]*r:id=/);
    expect(document).toContain('<w:rStyle w:val="Hyperlink"/>');
    expect(document).toContain('<w:rStyle w:val="InlineCode"/>');
    expect(document).toContain('<w:highlight w:val="yellow"/>');
    expect(document).toContain("<w:u ");
    expect(document).toContain("<w:strike/>");
    for (const style of ["Code", "Quote", "Divider", "InlineCode"]) {
      expect(styles).toContain(`w:styleId="${style}"`);
    }
    expect(document).toContain('<w:pStyle w:val="Quote"/>');
    expect(document).toContain('<w:pStyle w:val="Divider"/>');
  });

  it("keeps code lines in one Code paragraph and turns the page break into a Word page break", async () => {
    const { document } = await unzipDocx(fixtureBlocks(), IMAGE);
    const code = document.match(/<w:p>(?:(?!<w:p>)[\s\S])*?w:val="Code"[\s\S]*?<\/w:p>/)?.[0] ?? "";
    expect(code).toContain("const a = 1;");
    expect(code).toContain("<w:br/>");
    expect(code).toContain("const b = 2;");
    expect(document).toContain('<w:br w:type="page"/>');
  });

  it("sets the page size and the 1 inch margins; landscape swaps the sides", async () => {
    const portrait = await unzipDocx(fixtureBlocks(), IMAGE);
    expect(portrait.document).toMatch(/<w:pgSz w:w="11906" w:h="16838"/);
    expect(portrait.document).toMatch(
      /<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/,
    );
    const landscape = await unzipDocx(fixtureBlocks(), IMAGE, true);
    expect(landscape.document).toMatch(/<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/);
  });

  it("names the document after the Doc", async () => {
    const { core } = await unzipDocx(fixtureBlocks(), IMAGE);
    expect(core).toContain("<dc:title>Quote</dc:title>");
  });

  it("writes a valid body for an empty Doc", async () => {
    const { document } = await unzipDocx(editorJsonToExportBlocks({ type: "doc" }));
    expect(document).toContain("<w:body>");
    expect(document).toMatch(/<w:p>|<w:p\/>|<w:p /);
  });
});
