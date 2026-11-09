import { describe, expect, it } from "vitest";
import {
  NOTE_BODY_MAX_BYTES,
  NOTE_TITLE_MAX_LENGTH,
  decodeMarkdownBytes,
  fileNameTitle,
  finalizeImportedBody,
  importedBodyByteLength,
  isMarkdownImportFile,
  isRelativeImageSource,
  markdownImageFile,
  parseMarkdownNote,
  readMarkdownImportText,
} from "@/notes-core/src/notes-markdown-import";
import { splitFrontMatter } from "@/notes-core/src/notes-markdown-front-matter";

const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const DRIVE_SRC = `drive:fn-${"a".repeat(32)}`;

describe("front matter", () => {
  it("reads title and tags and strips the block from the body", () => {
    const { frontMatter, body } = splitFrontMatter(
      '---\ntitle: "Trip: Lisbon"\ntags: [travel, Food]\nauthor: me\n---\nBody line',
    );
    expect(frontMatter).toEqual({ title: "Trip: Lisbon", tags: ["travel", "Food"] });
    expect(body).toBe("Body line");
  });

  it("reads a block list and a comma-separated scalar", () => {
    expect(splitFrontMatter("---\ntags:\n  - one\n  - '#two'\n---\n").frontMatter?.tags).toEqual([
      "one",
      "two",
    ]);
    expect(splitFrontMatter("---\ntags: a, b ,c\n---\n").frontMatter?.tags).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("accepts ... as the closing line and single-quoted titles", () => {
    expect(splitFrontMatter("---\ntitle: 'It''s here'\n...\nx").frontMatter?.title).toBe(
      "It's here",
    );
  });

  it("is not front matter without a closing line", () => {
    const text = "---\ntitle: Nope\nStill text";
    expect(splitFrontMatter(text)).toEqual({ frontMatter: null, body: text });
  });

  it("is not front matter unless it starts on the first line", () => {
    expect(splitFrontMatter("\n---\ntitle: x\n---\n").frontMatter).toBeNull();
  });
});

describe("title rule", () => {
  it("prefers front matter title and keeps a first-line H1 in the body", () => {
    const parsed = parseMarkdownNote("---\ntitle: From YAML\n---\n# Heading\n\nText", "file.md");
    expect(parsed.title).toBe("From YAML");
    expect(parsed.body).toBe("# Heading\n\nText");
  });

  it("uses a first-line level-1 heading and removes it from the body", () => {
    const parsed = parseMarkdownNote("\n\n# Shopping list #\n\n- milk", "list.md");
    expect(parsed.title).toBe("Shopping list");
    expect(parsed.body).toBe("- milk");
  });

  it("does not use a level-2 heading or a later H1", () => {
    expect(parseMarkdownNote("## Sub\n# Late", "notes.markdown").title).toBe("notes");
    expect(parseMarkdownNote("Intro\n# Late", "a.b.txt").title).toBe("a.b");
  });

  it("falls back to the file name without extension", () => {
    expect(fileNameTitle("folder/My note.md")).toBe("My note");
    expect(fileNameTitle(".md")).toBe(".md");
  });

  it("cuts a long title to the API limit", () => {
    const parsed = parseMarkdownNote(`# ${"x".repeat(2000)}`, "a.md");
    expect(Array.from(parsed.title)).toHaveLength(NOTE_TITLE_MAX_LENGTH);
  });
});

describe("tags", () => {
  it("normalises valid tags, removes duplicates and lists invalid ones", () => {
    const parsed = parseMarkdownNote(
      "---\ntags: [Work, work, to-do, 2024, café, with space]\n---\n",
      "a.md",
    );
    expect(parsed.tags).toEqual(["work", "to-do"]);
    expect(parsed.droppedTags).toEqual(["2024", "café", "with space"]);
  });
});

describe("images", () => {
  it("extracts base64 data images and counts relative ones", () => {
    const parsed = parseMarkdownNote(
      [
        `![Dot](data:image/png;base64,${PNG_1PX})`,
        "![Local](images/photo.jpg)",
        "![Win](C:\\pics\\a.png)",
        "![Web](https://example.com/a.png)",
        "![Anchor](#top)",
      ].join("\n"),
      "a.md",
    );
    expect(parsed.images).toEqual([{ alt: "Dot", mimeType: "image/png", base64: PNG_1PX }]);
    expect(parsed.relativeImageCount).toBe(2);
    expect(parsed.body).toContain("![Local](images/photo.jpg)");
    expect(parsed.body).not.toContain("data:");
  });

  it("leaves images in fenced code blocks alone", () => {
    const text = "```md\n![x](rel.png)\n![y](data:image/png;base64,AAAA)\n```\n![z](rel2.png)";
    const parsed = parseMarkdownNote(text, "a.md");
    expect(parsed.images).toHaveLength(0);
    expect(parsed.relativeImageCount).toBe(1);
    expect(parsed.body).toBe(text);
  });

  it("finalises uploaded images as drive references and failed ones as alt text", () => {
    const parsed = parseMarkdownNote(
      `A ![one](data:image/png;base64,${PNG_1PX}) B ![two [x]](data:image/gif;base64,R0lG)`,
      "a.md",
    );
    expect(finalizeImportedBody(parsed, [DRIVE_SRC, null])).toBe(
      `A ![one](${DRIVE_SRC}) B two [x]`,
    );
    expect(finalizeImportedBody(parsed, [DRIVE_SRC, DRIVE_SRC])).toContain("![two \\[x\\]]");
  });

  it("marks data URLs that are not base64 images as not importable", () => {
    const parsed = parseMarkdownNote("![svg](data:image/svg+xml,%3Csvg%3E)", "a.md");
    expect(parsed.images[0]).toEqual({ alt: "svg", mimeType: null, base64: null });
    expect(markdownImageFile(parsed.images[0], 0)).toBeNull();
  });

  it("decodes a base64 image into a typed file", async () => {
    const file = markdownImageFile({ alt: "", mimeType: "image/jpeg", base64: PNG_1PX }, 2);
    expect(file?.name).toBe("image-3.jpg");
    expect(file?.type).toBe("image/jpeg");
    expect(file?.size).toBeGreaterThan(0);
    expect(markdownImageFile({ alt: "", mimeType: "image/png", base64: "%%%" }, 0)).toBeNull();
  });

  it("knows relative sources", () => {
    expect(isRelativeImageSource("a.png")).toBe(true);
    expect(isRelativeImageSource("../a.png")).toBe(true);
    expect(isRelativeImageSource("/abs/a.png")).toBe(true);
    expect(isRelativeImageSource("file:///a.png")).toBe(true);
    expect(isRelativeImageSource("//cdn.example/a.png")).toBe(false);
    expect(isRelativeImageSource("drive:fn-1")).toBe(false);
  });
});

describe("size and decoding", () => {
  it("measures the body with images as drive references", () => {
    const big = "A".repeat(NOTE_BODY_MAX_BYTES);
    const parsed = parseMarkdownNote(`![x](data:image/png;base64,${big})`, "a.md");
    expect(importedBodyByteLength(parsed)).toBe(`![x](${DRIVE_SRC})`.length);
    expect(importedBodyByteLength(parseMarkdownNote(`${big}é`, "a.md"))).toBe(
      NOTE_BODY_MAX_BYTES + 2,
    );
  });

  it("rejects invalid UTF-8 and binary content, drops a BOM, normalises line ends", () => {
    expect(decodeMarkdownBytes(new Uint8Array([0xff, 0xfe, 0x41]))).toBeNull();
    expect(decodeMarkdownBytes(new Uint8Array([0x41, 0x00, 0x42]))).toBeNull();
    expect(decodeMarkdownBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0x0d, 0x0a, 0x42]))).toBe(
      "A\nB",
    );
  });

  it("reads files and gives a reason when skipped", async () => {
    expect(isMarkdownImportFile({ name: "A.MD" })).toBe(true);
    expect(await readMarkdownImportText(new File(["x"], "a.pdf"))).toEqual({
      ok: false,
      reason: "unsupportedType",
    });
    expect(await readMarkdownImportText(new File([" \n\t"], "a.md"))).toEqual({
      ok: false,
      reason: "empty",
    });
    expect(await readMarkdownImportText(new File([new Uint8Array([0xc3, 0x28])], "a.md"))).toEqual({
      ok: false,
      reason: "notUtf8",
    });
    expect(await readMarkdownImportText(new File(["# Hi"], "a.txt"))).toEqual({
      ok: true,
      text: "# Hi",
    });
  });
});
