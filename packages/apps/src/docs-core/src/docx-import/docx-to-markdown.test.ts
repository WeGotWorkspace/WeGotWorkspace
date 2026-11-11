// @vitest-environment jsdom
import { strToU8, zipSync } from "fflate";
import { readDocxFixture } from "@/docs-core/src/docx-import/__tests__/fixtures/docx-fixtures";
import { describe, expect, it } from "vitest";
import { splitElements } from "@/docs-core/src/docx-import/docx-alternate-content";
import { scanDocx } from "@/docs-core/src/docx-import/docx-scan";
import {
  convertDocxToMarkdown,
  imagePlaceholder,
  tidyMammothHtml,
} from "@/docs-core/src/docx-import/docx-to-markdown";

const fixture = readDocxFixture;

describe("convertDocxToMarkdown", () => {
  it("keeps headings, Title as heading 1, Subtitle as text, marks and quotes", async () => {
    const { markdown, images } = await convertDocxToMarkdown(fixture("headings.docx"));
    expect(images).toEqual([]);
    expect(markdown).toContain("# Quarterly letter");
    expect(markdown).toMatch(/^Draft for the board$/m);
    for (const level of [1, 2, 3, 4, 5, 6]) {
      expect(markdown).toContain(`${"#".repeat(level)} Heading level ${level}`);
    }
    expect(markdown).toContain("**bold**");
    expect(markdown).toContain("*italic*");
    expect(markdown).toContain("<u>underlined</u>");
    expect(markdown).toContain("~~struck~~");
    expect(markdown).toContain("> A quoted line.");
  });

  it("keeps nested bulleted and numbered lists", async () => {
    const { markdown } = await convertDocxToMarkdown(fixture("lists.docx"));
    expect(markdown).toMatch(/^- Fruit$/m);
    expect(markdown).toMatch(/^ {2}- Apples$/m);
    expect(markdown).toMatch(/^ {4}- Green apples$/m);
    expect(markdown).toMatch(/^1\. Open the box$/m);
    expect(markdown).toMatch(/^ {3}1\. Check the parts$/m);
    expect(markdown).toMatch(/^2\. Build it$/m);
  });

  it("keeps a table with its header row", async () => {
    const { markdown } = await convertDocxToMarkdown(fixture("table.docx"));
    // The header row stays a header; its whole-cell bold is dropped (it shows bold anyway).
    expect(markdown).toMatch(/\| Item +\| Price +\|\n\| -+ \| -+ \|/);
    expect(markdown).toMatch(/\| Coffee +\| € 3 +\|/);
    expect(markdown).toContain("End of table.");
  });

  it("turns images into drive placeholders, never data URLs, and keeps links", async () => {
    const { markdown, images } = await convertDocxToMarkdown(fixture("image-link.docx"));
    expect(images).toHaveLength(1);
    expect(images[0].contentType).toBe("image/png");
    expect(images[0].bytes.byteLength).toBeGreaterThan(0);
    expect(markdown).toContain(`![Blue square logo](${imagePlaceholder(1)})`);
    expect(markdown).not.toContain("data:");
    expect(markdown).toContain("[the example site](https://example.com/more)");
  });

  it("accepts tracked changes, drops comments, and keeps notes as a Notes section", async () => {
    const { markdown } = await convertDocxToMarkdown(fixture("report.docx"));
    expect(markdown).toContain("Delivery in May.");
    expect(markdown).not.toContain("April");
    expect(markdown).not.toContain("Please check this number");
    expect(markdown).not.toContain("Company header");
    expect(markdown).toContain("in total\\[1\\].");
    expect(markdown).toContain("## Notes");
    expect(markdown).toContain("Source: internal estimate.");
    expect(markdown).toContain("Dates may move.");
    expect(markdown).not.toContain("footnote-");
    expect(markdown).not.toContain("↑");
  });

  it("counts a linked picture it cannot read, so the report can list it", async () => {
    const drawing = (attr: string) =>
      `<w:r><w:drawing><wp:inline><wp:docPr id="1" name="Pic"/><a:graphic><a:graphicData><pic:pic>` +
      `<pic:blipFill><a:blip ${attr}/></pic:blipFill></pic:pic></a:graphicData></a:graphic>` +
      `</wp:inline></w:drawing></w:r>`;
    const ns = [
      'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
      'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
      'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"',
      'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"',
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
    ].join(" ");
    const docx = zipSync({
      "[Content_Types].xml": strToU8(
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          "</Types>",
      ),
      "_rels/.rels": strToU8(
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
          "</Relationships>",
      ),
      "word/_rels/document.xml.rels": strToU8(
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rIdLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="file:///C:/pictures/logo.png" TargetMode="External"/>' +
          "</Relationships>",
      ),
      "word/document.xml": strToU8(
        `<?xml version="1.0"?><w:document ${ns}><w:body>` +
          `<w:p><w:r><w:t>Before</w:t></w:r>${drawing('r:link="rIdLink"')}</w:p>` +
          `</w:body></w:document>`,
      ),
    });
    const { markdown, images, unreadableImages } = await convertDocxToMarkdown(docx);
    expect(markdown.trim()).toBe("Before");
    expect(images).toEqual([]);
    expect(unreadableImages).toBe(1);
  });

  it("turns a Word page break into a Doc page break", async () => {
    const { markdown } = await convertDocxToMarkdown(fixture("report.docx"));
    expect(markdown).toMatch(
      /Red Georgia words and more\n\n<!-- pagebreak -->\n\nAfter the break\./,
    );
  });
});

describe("tidyMammothHtml", () => {
  it("moves a page break out of its paragraph", () => {
    expect(tidyMammothHtml('<p>a<hr class="wgw-page-break" /></p>')).toBe(
      '<p>a</p><div data-type="page-break"></div>',
    );
  });

  it("drops an underline inside a link, and keeps one outside", () => {
    expect(tidyMammothHtml('<p><a href="https://x.test"><u>link</u></a> <u>kept</u></p>')).toBe(
      '<p><a href="https://x.test">link</a> <u>kept</u></p>',
    );
  });
});

describe("scanDocx on the report fixture", () => {
  it("counts everything the converter drops", () => {
    const scan = scanDocx(fixture("report.docx"));
    expect(scan).toEqual({
      ok: true,
      counts: {
        comments: 2,
        trackedChanges: 2,
        headersAndFooters: 2,
        footnotes: 1,
        endnotes: 1,
        textBoxes: 1,
        textBoxesAsText: 0,
        alignment: 0,
        pageBreaks: 0,
        sections: 0,
        fonts: 1,
        colours: 1,
        embeddedObjects: 0,
      },
    });
  });

  it("counts aligned paragraphs", () => {
    const scan = scanDocx(fixture("headings.docx"));
    expect(scan.ok && scan.counts.alignment).toBe(1);
  });

  it("counts a text box with a fallback copy once, as text that is kept", () => {
    // How Word and LibreOffice save a text box: mammoth reads the fallback copy.
    const box = (change: string) =>
      `<w:txbxContent><w:p><w:pPr><w:jc w:val="center"/></w:pPr>${change}<w:r><w:t>Boxed</w:t></w:r></w:p></w:txbxContent>`;
    const ins = '<w:ins w:id="1" w:author="A"><w:r><w:t>new</w:t></w:r></w:ins>';
    const body =
      "<w:document><w:body><w:p><w:r><mc:AlternateContent>" +
      `<mc:Choice Requires="wps"><w:drawing><wps:txbx>${box(ins)}</wps:txbx></w:drawing></mc:Choice>` +
      `<mc:Fallback><w:pict><v:textbox>${box(ins)}</v:textbox></w:pict></mc:Fallback>` +
      "</mc:AlternateContent></w:r></w:p><w:sectPr/></w:body></w:document>";
    const scan = scanDocx(zipSync({ "word/document.xml": strToU8(body) }));
    expect(scan.ok && scan.counts).toMatchObject({
      textBoxes: 0,
      textBoxesAsText: 1,
      trackedChanges: 1,
      alignment: 1,
    });
  });
});

describe("splitElements", () => {
  it("separates nested and self-closing elements in one pass", () => {
    const xml =
      "a<mc:Fallback/>b<mc:Fallback x='1'><mc:Fallback>c</mc:Fallback>d</mc:Fallback>e<mc:FallbackX/>";
    expect(splitElements(xml, "mc:Fallback")).toEqual({
      inside: "<mc:Fallback/><mc:Fallback x='1'><mc:Fallback>c</mc:Fallback>d</mc:Fallback>",
      outside: "abe<mc:FallbackX/>",
    });
  });

  it("keeps an unclosed element inside instead of looping", () => {
    expect(splitElements("a<mc:Fallback>b", "mc:Fallback")).toEqual({
      inside: "<mc:Fallback>b",
      outside: "a",
    });
  });
});
