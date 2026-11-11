/**
 * Word → Markdown converter (#1619). Heavy: mammoth and a headless Docs editor.
 * Load it only through `loadDocxConverter()` so Docs and Drive bundles stay small.
 *
 * Path: .docx → mammoth HTML (style map below) → a headless editor with the
 * exact extension list Docs uses → `tiptap-markdown`. Only what a Doc can
 * store survives, and the Markdown is what the Docs editor would save.
 */
import { Editor } from "@tiptap/core";
import mammoth from "mammoth";
import { createTextEditorExtensions } from "@/text-editor-core/src/text-editor-extensions";
import { toDriveFnSrc } from "@/text-editor-core/src/text-editor-image-src";

export type DocxImage = {
  /** `drive:fn-…` stand-in in the Markdown until the real attachment id is known. */
  placeholder: string;
  contentType: string;
  bytes: Uint8Array;
};

export type DocxConversion = {
  markdown: string;
  images: DocxImage[];
  /** Images mammoth could not read (a linked picture, a missing part); they are left out. */
  unreadableImages?: number;
};

/** Maps Word styles the default mammoth map leaves out. Verified in the #1619 spike. */
export const DOCX_STYLE_MAP: readonly string[] = [
  // Google Docs and Word: Title → level-1 heading, Subtitle → plain paragraph (#1615).
  "p[style-name='Title'] => h1:fresh",
  "p[style-name='Subtitle'] => p:fresh",
  "p[style-name='Quote'] => blockquote > p:fresh",
  "p[style-name='Intense Quote'] => blockquote > p:fresh",
  "p[style-name='Code'] => pre:separator('\\n')",
  "r[style-name='Inline Code'] => code",
  "u => u",
  "highlight => mark",
  "br[type='page'] => hr.wgw-page-break",
];

/**
 * Placeholder FileNode ids: valid `drive:fn-` sources (so the image node keeps
 * them) that are swapped for the uploaded ids afterwards. Same length as a real id.
 */
export function imagePlaceholder(index: number): string {
  return toDriveFnSrc(`fn-${"0".repeat(24)}${index.toString(16).padStart(8, "0")}`);
}

/**
 * HTML fix-ups a style map cannot express:
 * - page breaks become the Docs page-break node;
 * - footnote and endnote references become plain "[n]" text, and mammoth's
 *   trailing note list becomes a "Notes" section without back-links;
 * - bold that covers a whole header cell is dropped (a header shows bold anyway).
 */
export function tidyMammothHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  for (const hr of doc.querySelectorAll("hr.wgw-page-break")) {
    const pageBreak = doc.createElement("div");
    pageBreak.setAttribute("data-type", "page-break");
    // The HTML parser closes a paragraph at <hr> and leaves an empty one after it.
    const next = hr.nextElementSibling;
    if (next?.tagName === "P" && !next.textContent && !next.children.length) next.remove();
    // A break still inside a list item or cell would split it; move it after the block.
    const block = hr.closest("li, td, th") ?? hr;
    block.after(pageBreak);
    hr.remove();
  }
  const notes = [...doc.querySelectorAll('li[id^="footnote-"], li[id^="endnote-"]')];
  for (const backLink of doc.querySelectorAll(
    'a[href^="#footnote-ref-"], a[href^="#endnote-ref-"]',
  )) {
    const text = backLink.previousSibling;
    if (text?.nodeType === Node.TEXT_NODE) text.textContent = (text.textContent ?? "").trimEnd();
    backLink.remove();
  }
  for (const ref of doc.querySelectorAll('a[href^="#footnote-"], a[href^="#endnote-"]')) {
    let outer: Element = ref;
    while (outer.parentElement?.tagName === "SUP") outer = outer.parentElement;
    outer.replaceWith(doc.createTextNode(ref.textContent ?? ""));
  }
  // A header cell shows bold in a Doc anyway. Word files (ours included) often
  // bold the whole header text too; keep only bold that covers part of a cell.
  for (const strong of doc.querySelectorAll("th strong")) {
    const parent = strong.parentElement;
    if (parent && parent.textContent?.trim() === strong.textContent?.trim()) {
      strong.replaceWith(...strong.childNodes);
    }
  }
  // Google Docs underlines links directly; a link shows as one anyway.
  for (const underline of doc.querySelectorAll("a u"))
    underline.replaceWith(...underline.childNodes);
  const list = notes[0]?.parentElement;
  if (list) {
    for (const note of notes) note.removeAttribute("id");
    const heading = doc.createElement("h2");
    heading.textContent = "Notes";
    list.before(heading);
  }
  return doc.body.innerHTML;
}

function markdownOf(editor: Editor): string {
  return (
    editor.storage as unknown as { markdown: { getMarkdown: () => string } }
  ).markdown.getMarkdown();
}

/** Builds the Doc's Markdown from mammoth HTML with the Docs schema. */
export function htmlToDocMarkdown(html: string): string {
  const editor = new Editor({
    extensions: createTextEditorExtensions({
      format: "markdown",
      // Never fetch images: the sources are placeholders until upload.
      fetchImageContent: async () => {
        throw new Error("Images are not fetched while converting.");
      },
    }),
    content: html,
  });
  try {
    return markdownOf(editor);
  } finally {
    editor.destroy();
  }
}

export async function convertDocxToMarkdown(bytes: Uint8Array): Promise<DocxConversion> {
  const images: DocxImage[] = [];
  let unreadableImages = 0;
  const arrayBuffer = bytes.slice().buffer;
  const result = await mammoth.convertToHtml(
    // The browser build reads `arrayBuffer`, the Node build (Vitest) `buffer`.
    { arrayBuffer, buffer: arrayBuffer } as { arrayBuffer: ArrayBuffer },
    {
      styleMap: [...DOCX_STYLE_MAP],
      convertImage: mammoth.images.imgElement(async (image) => {
        let data: Uint8Array;
        try {
          data = new Uint8Array(await image.readAsArrayBuffer());
        } catch (error) {
          // mammoth then drops the image; count it for the import report.
          unreadableImages += 1;
          throw error;
        }
        const placeholder = imagePlaceholder(images.length + 1);
        images.push({ placeholder, contentType: image.contentType, bytes: data });
        return { src: placeholder };
      }),
    },
  );
  return {
    markdown: htmlToDocMarkdown(tidyMammothHtml(result.value)),
    images,
    unreadableImages,
  };
}
