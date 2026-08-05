import { describe, expect, it } from "vitest";
import {
  decodeDocsPreviewContent,
  decodeUtf8Preview,
  fileSupportsTextPreview,
  formatPreviewText,
  isDocsEditorPreviewFile,
  isLikelyUtf8Text,
  isTextPreviewExtension,
  isUsableTextExcerpt,
  mediaAspectRatio,
  resolveDetailFilePreview,
  resolveGridFilePreview,
  stripPreviewText,
  truncatePreviewText,
} from "@/lib/file-preview/file-preview-utils";

describe("file preview text helpers", () => {
  it("strips markdown headings and emphasis", () => {
    expect(stripPreviewText("# Hello **world**", "notes.md")).toBe("Hello world");
  });

  it("leaves plain txt content unchanged aside from trim", () => {
    expect(stripPreviewText("  line one\nline two  ", "readme.txt")).toBe("line one\nline two");
  });

  it("truncates long preview text with ellipsis", () => {
    const long = "word ".repeat(200);
    const truncated = truncatePreviewText(long, 40);
    expect(truncated.endsWith("…")).toBe(true);
    expect(truncated.length).toBeLessThanOrEqual(40);
  });

  it("formats markdown files through strip and truncate", () => {
    const result = formatPreviewText("## Title\n\nBody copy here.", "doc.markdown", 20);
    expect(result).toContain("Title");
    expect(result.endsWith("…")).toBe(true);
  });

  it("recognizes common text preview extensions", () => {
    expect(isTextPreviewExtension("md")).toBe(true);
    expect(isTextPreviewExtension("json")).toBe(true);
    expect(isTextPreviewExtension("pdf")).toBe(false);
  });

  it("treats doc kind as text previewable when extension is only on api path", () => {
    expect(fileSupportsTextPreview("Roadmap 2026", "doc", "/users/alice/Roadmap 2026.md")).toBe(
      true,
    );
    expect(fileSupportsTextPreview("report", "doc", "/users/alice/report.pdf")).toBe(false);
  });

  it("rejects storage paths masquerading as excerpts", () => {
    expect(isUsableTextExcerpt("/users/alice/Roadmap.md", "/users/alice/Roadmap.md")).toBe(false);
    expect(isUsableTextExcerpt("Preview of Roadmap…", "/users/alice/Roadmap.md")).toBe(true);
  });

  it("detects UTF-8 text and rejects binary with NUL bytes", () => {
    const text = new TextEncoder().encode("hello world");
    const binary = new Uint8Array([0x00, 0x01, 0x02]);
    expect(isLikelyUtf8Text(text)).toBe(true);
    expect(isLikelyUtf8Text(binary)).toBe(false);
    expect(decodeUtf8Preview(text)).toBe("hello world");
    expect(decodeUtf8Preview(binary)).toBeNull();
  });

  it("recognizes docs-editor preview extensions", () => {
    expect(isDocsEditorPreviewFile("Spec.md")).toBe(true);
    expect(isDocsEditorPreviewFile("notes.txt")).toBe(true);
    expect(isDocsEditorPreviewFile("data.json")).toBe(false);
    expect(isDocsEditorPreviewFile("Untitled", "/users/alice/Untitled.markdown")).toBe(true);
  });

  it("decodes full docs preview content without markdown stripping", () => {
    const bytes = new TextEncoder().encode("# Title\n\nBody");
    expect(decodeDocsPreviewContent(bytes)).toBe("# Title\n\nBody");
  });

  it("decodes empty docs preview content for zero-byte files", () => {
    expect(decodeDocsPreviewContent(new Uint8Array())).toBe("");
  });

  it("prefers rich detail preview over tile text preview", () => {
    const resolved = resolveDetailFilePreview(
      { "doc-1": { kind: "text", content: "tile excerpt" } },
      { "doc-1": { kind: "docs", content: "# Full body" } },
      "doc-1",
    );
    expect(resolved).toEqual({ kind: "docs", content: "# Full body" });
  });

  it("omits text and docs payloads from grid tiles", () => {
    expect(
      resolveGridFilePreview(
        { "doc-1": { kind: "text", content: "tile excerpt" } },
        { "doc-1": { kind: "docs", content: "# Full body" } },
        "doc-1",
      ),
    ).toBeUndefined();
  });

  it("keeps media blob previews for grid tiles", () => {
    const media = { kind: "blob-url" as const, url: "blob:photo" };
    expect(resolveGridFilePreview({ "img-1": media }, {}, "img-1")).toEqual(media);
  });

  it("derives media aspect ratio from blob preview dimensions", () => {
    expect(mediaAspectRatio(1600, 900)).toBeCloseTo(16 / 9);
    expect(mediaAspectRatio(0, 900)).toBeNull();
  });
});
