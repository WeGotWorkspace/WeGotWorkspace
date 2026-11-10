import { strToU8, zipSync } from "fflate";
import { readDocxFixture } from "@/docs-core/src/docx-import/__tests__/fixtures/docx-fixtures";
import { describe, expect, it, vi } from "vitest";
import { DOCX_MAX_UNPACKED_BYTES } from "@/docs-core/src/docx-import/docx-scan";
import type { DocxConversion } from "@/docs-core/src/docx-import/docx-to-markdown";
import {
  DOC_MAX_MARKDOWN_BYTES,
  DocxSaveRefusedError,
  markdownNameFor,
  saveDocxAsMarkdown,
  type SaveAsMarkdownIo,
} from "@/docs-core/src/docx-import/save-docx-as-markdown";

const reportDocx = readDocxFixture("report.docx");
const PLACEHOLDER = `drive:fn-${"0".repeat(31)}1`;
const NODE_ID = "fn-doc";
const UPLOADED = `fn-${"a".repeat(32)}`;

function fakeIo(bytes: Uint8Array, overrides: Partial<SaveAsMarkdownIo> = {}) {
  const calls: string[] = [];
  const written: Record<string, string> = {};
  const io: SaveAsMarkdownIo = {
    readSource: vi.fn(async (path: string) => {
      calls.push(`read ${path}`);
      return bytes;
    }),
    createEmptyDoc: vi.fn(async (parent: string, name: string) => {
      calls.push(`create ${parent} ${name}`);
      return { name: name.replace(".md", " (1).md"), nodeId: NODE_ID };
    }),
    uploadImage: vi.fn(async (docPath: string, nodeId: string, file: File) => {
      calls.push(`upload ${docPath} ${nodeId} ${file.name} ${file.type}`);
      return UPLOADED;
    }),
    writeDoc: vi.fn(async (nodeId: string, markdown: string) => {
      calls.push(`write ${nodeId}`);
      written[nodeId] = markdown;
    }),
    removeDoc: vi.fn(async (docPath: string, nodeId: string) => {
      calls.push(`remove ${docPath} ${nodeId}`);
    }),
    ...overrides,
  };
  return { io, calls, written };
}

const conversion = (markdown: string, contentType = "image/png"): DocxConversion => ({
  markdown,
  images: [{ placeholder: PLACEHOLDER, contentType, bytes: new Uint8Array([1, 2, 3]) }],
});

describe("saveDocxAsMarkdown", () => {
  it("creates, uploads images, then writes the Markdown once", async () => {
    const { io, calls, written } = fakeIo(reportDocx);
    const result = await saveDocxAsMarkdown("/users/ann/Letters/Plan.docx", io, async () =>
      conversion(`# Plan\n\n![Logo](${PLACEHOLDER})\n`),
    );
    expect(calls).toEqual([
      "read /users/ann/Letters/Plan.docx",
      "create /users/ann/Letters Plan.md",
      "upload /users/ann/Letters/Plan (1).md fn-doc image-1.png image/png",
      "write fn-doc",
    ]);
    expect(result.docPath).toBe("/users/ann/Letters/Plan (1).md");
    expect(written[NODE_ID]).toBe(`# Plan\n\n![Logo](drive:${UPLOADED})\n`);
    expect(result.report.sourceName).toBe("Plan.docx");
    expect(result.report.lines.map((line) => line.id)).toEqual([
      "comments",
      "trackedChanges",
      "headersAndFooters",
      "footnotes",
      "endnotes",
      "textBoxes",
      "fonts",
      "colours",
    ]);
  });

  it("drops an image whose upload fails and reports it", async () => {
    const { io, written } = fakeIo(reportDocx, {
      uploadImage: vi.fn(async () => {
        throw new Error("offline");
      }),
    });
    const html = `<table><tr><td><img src="${PLACEHOLDER}" alt="x"></td></tr></table>`;
    const result = await saveDocxAsMarkdown("/users/ann/Plan.docx", io, async () =>
      conversion(`Before ![Logo \\] x](${PLACEHOLDER}) after\n\n${html}\n`),
    );
    expect(written[NODE_ID]).toBe("Before  after\n\n<table><tr><td></td></tr></table>\n");
    expect(result.report.lines.at(-1)).toMatchObject({ id: "failedImages", count: 1 });
  });

  it("does not upload an image type a Doc cannot show", async () => {
    const { io } = fakeIo(reportDocx);
    const result = await saveDocxAsMarkdown("/users/ann/Plan.docx", io, async () =>
      conversion(`![Chart](${PLACEHOLDER})`, "image/x-emf"),
    );
    expect(io.uploadImage).not.toHaveBeenCalled();
    expect(result.report.lines.at(-1)).toMatchObject({ id: "failedImages", count: 1 });
  });

  it.each([
    [
      "an old .doc or protected file",
      new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1]),
      "ole-container",
    ],
    ["plain text", strToU8("hello, I am not a Word file"), "not-a-zip"],
    ["a corrupt zip", reportDocx.slice(0, 600), "corrupt-zip"],
    ["a zip without a Word document", zipSync({ "readme.txt": strToU8("hi") }), "not-a-docx"],
  ])("refuses %s and writes nothing", async (_label, bytes, refusal) => {
    const { io } = fakeIo(bytes);
    const convert = vi.fn();
    await expect(saveDocxAsMarkdown("/users/ann/x.docx", io, convert)).rejects.toEqual(
      new DocxSaveRefusedError(refusal as DocxSaveRefusedError["refusal"]),
    );
    expect(convert).not.toHaveBeenCalled();
    expect(io.createEmptyDoc).not.toHaveBeenCalled();
    expect(io.writeDoc).not.toHaveBeenCalled();
  });

  it("refuses a zip bomb whose headers declare a small size, without converting", async () => {
    const bomb = zipSync({
      "word/document.xml": strToU8("<w:document/>"),
      "word/media/huge.bin": new Uint8Array(DOCX_MAX_UNPACKED_BYTES + 1024),
    });
    expect(bomb.byteLength).toBeLessThan(DOCX_MAX_UNPACKED_BYTES / 100);
    // Claim 10 bytes in every central-directory entry; the deflate stream is unchanged.
    const view = new DataView(bomb.buffer, bomb.byteOffset, bomb.byteLength);
    for (let i = 0; i + 46 <= bomb.length; i += 1) {
      if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, 10, true);
    }
    const { io } = fakeIo(bomb);
    const convert = vi.fn();
    await expect(saveDocxAsMarkdown("/users/ann/x.docx", io, convert)).rejects.toMatchObject({
      refusal: "too-large",
    });
    expect(convert).not.toHaveBeenCalled();
    expect(io.createEmptyDoc).not.toHaveBeenCalled();
  }, 60_000);

  it("refuses a file the converter cannot read, and writes nothing", async () => {
    const { io } = fakeIo(reportDocx);
    await expect(
      saveDocxAsMarkdown("/users/ann/x.docx", io, async () => {
        throw new Error("Corrupted zip: missing 1 bytes");
      }),
    ).rejects.toMatchObject({ refusal: "unreadable" });
    expect(io.createEmptyDoc).not.toHaveBeenCalled();
  });

  it("refuses a result above the 2 MiB Doc limit before writing", async () => {
    const { io } = fakeIo(reportDocx);
    const tooBig = "é".repeat(DOC_MAX_MARKDOWN_BYTES / 2 + 1);
    await expect(
      saveDocxAsMarkdown("/users/ann/x.docx", io, async () => ({ markdown: tooBig, images: [] })),
    ).rejects.toMatchObject({ refusal: "doc-too-large" });
    expect(io.createEmptyDoc).not.toHaveBeenCalled();
  });

  it("removes the new Doc when writing fails", async () => {
    const { io, calls } = fakeIo(reportDocx, {
      writeDoc: vi.fn(async () => {
        throw new Error("network");
      }),
    });
    await expect(
      saveDocxAsMarkdown("/users/ann/x.docx", io, async () => ({ markdown: "hi", images: [] })),
    ).rejects.toThrow("network");
    expect(calls.at(-1)).toBe("remove /users/ann/x (1).md fn-doc");
  });
});

describe("markdownNameFor", () => {
  it.each([
    ["Plan.docx", "Plan.md"],
    ["Plan.v2.docx", "Plan.v2.md"],
    [".docx", ".docx.md"],
    ["  .docx", "Untitled.md"],
  ])("%s → %s", (source, expected) => {
    expect(markdownNameFor(source)).toBe(expected);
  });
});
