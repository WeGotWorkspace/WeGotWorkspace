import { describe, expect, it } from "vitest";
import { TEXT_EDITOR_PAGE_FORMAT_SPECS } from "@/lib/page-format";
import { docsExportFileName, docsExportPage } from "./docs-download-word";

describe("docsExportFileName", () => {
  it("replaces the Doc's extension", () => {
    expect(docsExportFileName("Quote.md", "docx")).toBe("Quote.docx");
    expect(docsExportFileName("Notes.TXT", "pdf")).toBe("Notes.pdf");
    expect(docsExportFileName("Plan v1.2", "docx")).toBe("Plan v1.2.docx");
  });

  it("replaces path and control characters and falls back to Document", () => {
    expect(docsExportFileName("a/b:c?.md", "docx")).toBe("a-b-c-.docx");
    expect(docsExportFileName("  ", "docx")).toBe("Document.docx");
    expect(docsExportFileName(".md", "docx")).toBe("Document.docx");
  });
});

describe("docsExportPage", () => {
  it("follows the Doc's paper and orientation", () => {
    expect(docsExportPage({ format: "letter", orientation: "landscape" }, ["nl-NL"])).toEqual({
      width: 816,
      height: 1056,
      landscape: true,
      margin: 96,
    });
  });

  it("uses the locale default for paper None", () => {
    expect(docsExportPage({ format: "none", orientation: "portrait" }, ["en-US"]).width).toBe(816);
    expect(docsExportPage({ format: "none", orientation: "portrait" }, ["nl-NL"]).width).toBe(
      TEXT_EDITOR_PAGE_FORMAT_SPECS.a4.width,
    );
    expect(docsExportPage(undefined, ["en-CA"]).height).toBe(1056);
  });
});
