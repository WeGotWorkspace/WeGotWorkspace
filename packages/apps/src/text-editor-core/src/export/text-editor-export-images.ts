import type { Editor } from "@tiptap/core";
import type { DocsImageContentFetcher } from "@/text-editor-core/src/text-editor-image-content";
import { fetchDocsImageContentByNodeId } from "@/text-editor-core/src/text-editor-image-content";
import { parseDriveFnSrc } from "@/text-editor-core/src/text-editor-image-src";

/** Image formats a Word file embeds as they are. Anything else is re-encoded to PNG. */
export type ExportImageType = "png" | "jpg" | "gif" | "bmp";

export type ExportImage = {
  bytes: Uint8Array;
  type: ExportImageType;
  /** Natural size in CSS px. */
  width: number;
  height: number;
};

/** Image bytes by `src`; `null` when the image could not be included. */
export type ExportImages = Map<string, ExportImage | null>;

type ImageHeader = { type: ExportImageType; width: number; height: number };

function u16be(b: Uint8Array, i: number) {
  return (b[i] << 8) | b[i + 1];
}
function u32be(b: Uint8Array, i: number) {
  return ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
}
function u16le(b: Uint8Array, i: number) {
  return b[i] | (b[i + 1] << 8);
}
function i32le(b: Uint8Array, i: number) {
  return b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24);
}

function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    // SOF0–SOF15 carry the frame size, except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: u16be(b, i + 5), width: u16be(b, i + 7) };
    }
    i += 2 + u16be(b, i + 2);
  }
  return null;
}

/** Type and natural size from the file header, without decoding the image. */
export function readImageHeader(bytes: Uint8Array): ImageHeader | null {
  const b = bytes;
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { type: "png", width: u32be(b, 16), height: u32be(b, 20) };
  }
  if (b.length >= 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    return { type: "gif", width: u16le(b, 6), height: u16le(b, 8) };
  }
  if (b.length >= 26 && b[0] === 0x42 && b[1] === 0x4d) {
    return { type: "bmp", width: Math.abs(i32le(b, 18)), height: Math.abs(i32le(b, 22)) };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    const size = jpegSize(b);
    return size ? { type: "jpg", ...size } : null;
  }
  return null;
}

/** WebP, AVIF, SVG and the like: draw to a canvas and keep the PNG. Browser only. */
async function reencodeAsPng(blob: Blob): Promise<ExportImage | null> {
  if (typeof document === "undefined") return null;
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    const width = img.naturalWidth || 300;
    const height = img.naturalHeight || 150;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")?.drawImage(img, 0, 0, width, height);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!png) return null;
    return { bytes: new Uint8Array(await png.arrayBuffer()), type: "png", width, height };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function exportImageFromBlob(blob: Blob): Promise<ExportImage | null> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const header = readImageHeader(bytes);
  if (header && header.width > 0 && header.height > 0) return { bytes, ...header };
  return reencodeAsPng(blob);
}

/** The fetcher the editor's image extension uses (the same one the node view calls). */
export function editorImageFetcher(editor: Editor): DocsImageContentFetcher {
  const image = editor.extensionManager.extensions.find((ext) => ext.name === "image");
  const fetchContent = (image?.options as { fetchContent?: DocsImageContentFetcher } | undefined)
    ?.fetchContent;
  return fetchContent ?? fetchDocsImageContentByNodeId;
}

/** The blob the node view already shows for `src`, if any (works offline). */
async function shownImageBlob(editor: Editor, src: string): Promise<Blob | null> {
  let objectUrl: string | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (objectUrl) return false;
    if (node.type.name !== "image" || node.attrs.src !== src) return true;
    const dom = editor.view.nodeDOM(pos);
    const img =
      dom instanceof HTMLImageElement
        ? dom
        : dom instanceof HTMLElement
          ? dom.querySelector("img")
          : null;
    if (img?.src.startsWith("blob:")) objectUrl = img.src;
    return false;
  });
  if (!objectUrl) return null;
  try {
    const res = await fetch(objectUrl);
    return res.ok ? await res.blob() : null;
  } catch {
    return null;
  }
}

/** A network fetch that has not answered by then counts as failed (offline can hang). */
const FETCH_TIMEOUT_MS = 20_000;

async function fetchWithTimeout(
  fetcher: DocsImageContentFetcher,
  nodeId: string,
  signal?: AbortSignal,
): Promise<Blob | null> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, FETCH_TIMEOUT_MS);
  try {
    return await Promise.race([
      fetcher(nodeId, controller.signal),
      new Promise<null>((resolve) =>
        controller.signal.addEventListener("abort", () => resolve(null)),
      ),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

async function collectOne(
  editor: Editor,
  fetcher: DocsImageContentFetcher,
  src: string,
  signal?: AbortSignal,
): Promise<ExportImage | null> {
  // External images stay out: the editor only loads them after a per-host opt-in,
  // and their host usually blocks reading the bytes.
  const nodeId = parseDriveFnSrc(src);
  if (!nodeId) return null;
  // The bytes the editor already shows need no network, so this also works offline.
  const blob =
    (await shownImageBlob(editor, src)) ?? (await fetchWithTimeout(fetcher, nodeId, signal));
  return blob ? exportImageFromBlob(blob) : null;
}

const CONCURRENCY = 4;

/** Fetch every Drive image once, a few at a time. Failures become `null`, never a throw. */
export async function collectExportImages(
  editor: Editor,
  sources: readonly string[],
  signal?: AbortSignal,
): Promise<ExportImages> {
  const fetcher = editorImageFetcher(editor);
  const images: ExportImages = new Map();
  let next = 0;
  const worker = async () => {
    while (next < sources.length) {
      const src = sources[next++];
      images.set(src, await collectOne(editor, fetcher, src, signal).catch(() => null));
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, sources.length) }, worker));
  return images;
}
