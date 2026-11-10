/** @vitest-environment jsdom */
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTextEditorExtensions } from "@/text-editor-core/src/text-editor-extensions";
import type { DocsImageContentFetcher } from "@/text-editor-core/src/text-editor-image-content";
import { collectExportImages, readImageHeader } from "./text-editor-export-images";

const DRIVE_A = "drive:fn-0123456789abcdef0123456789abcdef";
const DRIVE_B = "drive:fn-fedcba9876543210fedcba9876543210";

function png(width: number, height: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function editorWith(fetchImageContent: DocsImageContentFetcher, srcs: string[]): Editor {
  const editor = new Editor({
    extensions: createTextEditorExtensions({ format: "markdown", fetchImageContent }),
    content: srcs.map((src, i) => `![Image ${i}](${src})`).join("\n\n"),
  });
  editors.push(editor);
  return editor;
}

describe("readImageHeader", () => {
  it("reads PNG, GIF, BMP and JPEG sizes from the header", () => {
    expect(readImageHeader(png(640, 480))).toEqual({ type: "png", width: 640, height: 480 });

    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x20, 0x03, 0x58, 0x02]);
    expect(readImageHeader(gif)).toEqual({ type: "gif", width: 800, height: 600 });

    const bmp = new Uint8Array(26);
    bmp.set([0x42, 0x4d]);
    new DataView(bmp.buffer).setInt32(18, 100, true);
    new DataView(bmp.buffer).setInt32(22, -50, true);
    expect(readImageHeader(bmp)).toEqual({ type: "bmp", width: 100, height: 50 });

    // SOI, an APP0 segment of 4 bytes, then SOF0 with height 200 and width 300.
    const jpg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0xc8,
      0x01, 0x2c, 0x03,
    ]);
    expect(readImageHeader(jpg)).toEqual({ type: "jpg", width: 300, height: 200 });
  });

  it("returns null for formats Word cannot embed as they are", () => {
    const webp = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");
    expect(readImageHeader(webp)).toBeNull();
  });
});

describe("collectExportImages", () => {
  it("fetches each Drive image once through the editor's own fetcher", async () => {
    const fetcher = vi.fn<DocsImageContentFetcher>(async () => new Blob([png(10, 20)]));
    const editor = editorWith(fetcher, [DRIVE_A, DRIVE_B]);
    const images = await collectExportImages(editor, [DRIVE_A, DRIVE_B]);
    expect(images.get(DRIVE_A)).toMatchObject({ type: "png", width: 10, height: 20 });
    expect(images.get(DRIVE_B)).toMatchObject({ type: "png" });
    const signal = expect.any(AbortSignal);
    expect(fetcher).toHaveBeenCalledWith("fn-0123456789abcdef0123456789abcdef", signal);
    expect(fetcher).toHaveBeenCalledWith("fn-fedcba9876543210fedcba9876543210", signal);
  });

  it("gives null for an image that cannot be fetched or shown, without throwing", async () => {
    const editor = editorWith(async () => {
      throw new Error("offline");
    }, [DRIVE_A]);
    const images = await collectExportImages(editor, [DRIVE_A]);
    expect(images.get(DRIVE_A)).toBeNull();
  });

  it("gives up on a fetch that never answers (offline can hang)", async () => {
    vi.useFakeTimers();
    try {
      const editor = editorWith(() => new Promise<Blob>(() => {}), [DRIVE_A]);
      const pending = collectExportImages(editor, [DRIVE_A]);
      await vi.advanceTimersByTimeAsync(20_000);
      expect((await pending).get(DRIVE_A)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not fetch external images", async () => {
    const fetcher = vi.fn<DocsImageContentFetcher>();
    const editor = editorWith(fetcher, []);
    const images = await collectExportImages(editor, ["https://example.com/logo.png"]);
    expect(images.get("https://example.com/logo.png")).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
