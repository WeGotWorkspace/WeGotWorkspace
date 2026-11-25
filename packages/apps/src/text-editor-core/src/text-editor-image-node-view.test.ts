/** @vitest-environment jsdom */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getTextEditorContent } from "./text-editor-content";
import { createTextEditorExtensions } from "./text-editor-extensions";
import {
  deselectDocsImage,
  isDocsImageNodeSelection,
  replaceDocsImageAt,
  setDocsImageLayoutAt,
} from "./text-editor-image-commands";
import { normalizeDocsImageHref } from "./text-editor-image-attrs";
import { dragWidthPercent } from "./text-editor-image-node-view";
import { splitImageFragment } from "./text-editor-image-src";

const NODE_ID = "fn-cccccccccccccccccccccccccccccccc";
const PIXEL_PNG = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });

function findImagePos(editor: Editor): number {
  let pos = -1;
  editor.state.doc.descendants((node, nodePos) => {
    if (node.type.name === "image") {
      pos = nodePos;
      return false;
    }
    return true;
  });
  return pos;
}

function mountEditor(
  editable = true,
  content = `Before\n\n![Team photo](drive:${NODE_ID})\n\nAfter`,
): Editor {
  const editor = new Editor({
    editable,
    extensions: createTextEditorExtensions({
      format: "markdown",
      fetchImageContent: vi.fn(async () => PIXEL_PNG),
    }),
    content,
  });
  document.body.append(editor.view.dom);
  return editor;
}

function imageElements(editor: Editor): HTMLImageElement[] {
  return [...editor.view.dom.querySelectorAll(".text-editor-image img")] as HTMLImageElement[];
}

function wrapperOf(editor: Editor): HTMLElement {
  return editor.view.dom.querySelector(".text-editor-image") as HTMLElement;
}

function captionOf(editor: Editor): HTMLElement {
  return editor.view.dom.querySelector(".text-editor-image__caption") as HTMLElement;
}

describe("docs image node view layout and caption", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("has no hover trash: delete lives in the image bar", () => {
    const editor = mountEditor();
    expect(editor.view.dom.querySelector(".text-editor-image__delete-host")).toBeNull();
    expect(editor.view.dom.querySelector("button[aria-label='Delete image']")).toBeNull();
    editor.destroy();
  });

  it("applies width and alignment from the node attrs", () => {
    const editor = mountEditor();
    expect(wrapperOf(editor).dataset.align).toBe("start");
    expect(wrapperOf(editor).style.width).toBe("");
    setDocsImageLayoutAt(editor, findImagePos(editor), { width: 50, align: "end" });
    expect(wrapperOf(editor).style.width).toBe("50%");
    expect(wrapperOf(editor).dataset.align).toBe("end");
    editor.destroy();
  });

  it("shows the caption placeholder only while the image is focused", () => {
    const editor = mountEditor();
    expect(wrapperOf(editor).dataset.focused).toBe("false");
    editor.commands.setNodeSelection(findImagePos(editor));
    expect(wrapperOf(editor).dataset.focused).toBe("true");
    expect(wrapperOf(editor).classList.contains("ProseMirror-selectednode")).toBe(true);
    expect(captionOf(editor).dataset.placeholder).toBe("Add a caption");
    expect(deselectDocsImage(editor)).toBe(true);
    expect(wrapperOf(editor).dataset.focused).toBe("false");
    editor.destroy();
  });

  it("writes caption typing to the node and keeps it read-only for guests", () => {
    const editor = mountEditor();
    const caption = captionOf(editor);
    expect(caption.contentEditable).toBe("true");
    caption.textContent = "Our  team";
    fireEvent.input(caption);
    expect(editor.state.doc.nodeAt(findImagePos(editor))?.attrs.title).toBe("Our team");
    editor.destroy();

    const guest = mountEditor(false, `![Team](drive:${NODE_ID})`);
    expect(captionOf(guest).contentEditable).toBe("false");
    guest.destroy();
  });

  it("writes standard markdown: width and alignment in the src fragment, the caption as title", () => {
    const editor = mountEditor();
    expect(getTextEditorContent(editor, "markdown")).toContain(`![Team photo](drive:${NODE_ID})`);
    setDocsImageLayoutAt(editor, findImagePos(editor), {
      width: 75,
      align: "end",
      title: 'Say "hi" (twice)',
    });
    const markdown = getTextEditorContent(editor, "markdown");
    expect(markdown).toContain(
      `![Team photo](drive:${NODE_ID}#width=75&align=end "Say \\"hi\\" (twice)")`,
    );
    expect(markdown).not.toContain("<img");
    editor.destroy();

    const reloaded = mountEditor(true, markdown);
    const attrs = reloaded.state.doc.nodeAt(findImagePos(reloaded))?.attrs;
    expect(attrs).toMatchObject({ width: 75, align: "end", title: 'Say "hi" (twice)' });
    // The fragment is markdown's business: the node keeps a clean src.
    expect(attrs?.src).toBe(`drive:${NODE_ID}`);
    reloaded.destroy();
  });

  it('keeps a caption-only image as `![alt](src "caption")` and reads titles as captions', () => {
    const editor = mountEditor(true, `![Rock](drive:${NODE_ID} "Shiprock, New Mexico")`);
    expect(editor.state.doc.nodeAt(findImagePos(editor))?.attrs.title).toBe("Shiprock, New Mexico");
    expect(captionOf(editor).textContent).toBe("Shiprock, New Mexico");
    expect(editor.view.dom.querySelector("img")?.getAttribute("title")).toBeNull();
    expect(getTextEditorContent(editor, "markdown")).toContain(
      `![Rock](drive:${NODE_ID} "Shiprock, New Mexico")`,
    );
    editor.destroy();
  });

  it("keeps an image that is a link, and opens it for readers only", () => {
    const md = `[![An old rock](https://example.com/rock.jpg "Shiprock")](https://www.domain.com/image.jpg)`;
    const editor = mountEditor(true, md);
    const attrs = editor.state.doc.nodeAt(findImagePos(editor))?.attrs;
    expect(attrs).toMatchObject({
      src: "https://example.com/rock.jpg",
      title: "Shiprock",
      href: "https://www.domain.com/image.jpg",
    });
    expect(getTextEditorContent(editor, "markdown")).toContain(md);

    const open = vi.spyOn(window, "open").mockReturnValue(null);
    fireEvent.click(editor.view.dom.querySelector("img")!);
    expect(open).not.toHaveBeenCalled();
    editor.setEditable(false);
    fireEvent.click(editor.view.dom.querySelector("img")!);
    expect(open).toHaveBeenCalledWith(
      "https://www.domain.com/image.jpg",
      "_blank",
      "noopener,noreferrer",
    );
    open.mockRestore();
    editor.destroy();
  });

  it("splits only our keys out of an image fragment and refuses unsafe links", () => {
    expect(splitImageFragment("https://x.test/a.png#width=50&align=end&t=1")).toEqual({
      src: "https://x.test/a.png#t=1",
      width: 50,
      align: "end",
    });
    expect(splitImageFragment(`drive:${NODE_ID}#width=500&align=up`)).toEqual({
      src: `drive:${NODE_ID}`,
      width: 100,
      align: null,
    });
    // `left` / `right` (an earlier name) read as `start` / `end`; `start` stays out of markdown.
    expect(splitImageFragment(`drive:${NODE_ID}#align=right`).align).toBe("end");
    expect(splitImageFragment(`drive:${NODE_ID}#align=left`).align).toBe("start");
    expect(normalizeDocsImageHref("javascript:alert(1)")).toBeNull();
    expect(normalizeDocsImageHref("https://ok.test")).toBe("https://ok.test");
  });

  it("replaces the picture and keeps width, alignment and caption", () => {
    const editor = mountEditor();
    const pos = findImagePos(editor);
    setDocsImageLayoutAt(editor, pos, { width: 50, title: "Hello" });
    replaceDocsImageAt(editor, pos, "fn-dddddddddddddddddddddddddddddddd", "New");
    expect(editor.state.doc.nodeAt(pos)?.attrs).toMatchObject({
      src: "drive:fn-dddddddddddddddddddddddddddddddd",
      alt: "New",
      width: 50,
      title: "Hello",
    });
    editor.destroy();
  });

  it("turns a side drag into a % of the column, relative to where the drag started", () => {
    const base = { startX: 300, startWidth: 200, columnWidth: 400 };
    // No movement: no jump, whatever the grab offset from the edge.
    expect(dragWidthPercent({ ...base, clientX: 300, side: "end", align: "start" })).toBe(50);
    // Edge-anchored: 100px outward is 100px wider.
    expect(dragWidthPercent({ ...base, clientX: 400, side: "end", align: "start" })).toBe(75);
    expect(dragWidthPercent({ ...base, clientX: 200, side: "start", align: "end" })).toBe(75);
    // Centred: both edges move, so 50px outward is 100px wider.
    expect(dragWidthPercent({ ...base, clientX: 350, side: "end", align: "center" })).toBe(75);
    expect(dragWidthPercent({ ...base, clientX: 250, side: "start", align: "center" })).toBe(75);
    // Right-to-left: the end edge is on the left, so outward is leftward.
    const rtl = { ...base, rtl: true };
    expect(dragWidthPercent({ ...rtl, clientX: 200, side: "end", align: "start" })).toBe(75);
    expect(dragWidthPercent({ ...rtl, clientX: 400, side: "start", align: "end" })).toBe(75);
    expect(dragWidthPercent({ ...base, clientX: 900, side: "end", align: "start" })).toBe(100);
    expect(dragWidthPercent({ ...base, clientX: -900, side: "end", align: "start" })).toBe(5);
  });

  it("clears the selected ring on Escape without removing the image", () => {
    const editor = mountEditor();
    const wrapper = editor.view.dom.querySelector(".text-editor-image");
    editor.commands.setNodeSelection(findImagePos(editor));
    expect(isDocsImageNodeSelection(editor)).toBe(true);
    expect(deselectDocsImage(editor)).toBe(true);
    expect(isDocsImageNodeSelection(editor)).toBe(false);
    expect(wrapper?.classList.contains("ProseMirror-selectednode")).toBe(false);
    expect(editor.view.dom.querySelector(".text-editor-image")).toBeTruthy();
    editor.destroy();
  });
});

const HTTPS_SRC = "https://cdn.example/photo.png";
const OTHER_HTTPS_SRC = "https://other.example/photo.png";
const HTTP_SRC = "http://cdn.example/legacy.png";
const LOOPBACK_SRC = "https://127.0.0.1/secret.png";
const USERINFO_SRC = "https://user:secret@cdn.example/photo.png";

describe("docs image external opt-in", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("does not request an https image until the reader opts in", () => {
    const editor = mountEditor(false, `![Photo](${HTTPS_SRC})`);
    const img = imageElements(editor)[0];
    expect(img?.getAttribute("src")).toBeNull();
    expect(getTextEditorContent(editor, "markdown")).toContain(HTTPS_SRC);

    fireEvent.click(
      screen.getByRole("button", { name: "Load external image: Photo (cdn.example)" }),
    );
    expect(img?.getAttribute("src")).toBe(HTTPS_SRC);
    editor.destroy();
  });

  it("labels the opt-in with the alt and host and omits URL userinfo", () => {
    const editor = mountEditor(false, `![Photo](${USERINFO_SRC})`);
    expect(imageElements(editor)[0]?.getAttribute("src")).toBeNull();
    const button = screen.getByRole("button", {
      name: "Load external image: Photo (cdn.example)",
    });
    expect(button.textContent).not.toContain("secret");
    fireEvent.click(button);
    expect(imageElements(editor)[0]?.getAttribute("src")).toBe(USERINFO_SRC);
    editor.destroy();
  });

  it("falls back to the host label when the image has no alt", () => {
    const editor = mountEditor(false, `![](${HTTPS_SRC})`);
    fireEvent.click(screen.getByRole("button", { name: "Load external image (cdn.example)" }));
    expect(imageElements(editor)[0]?.getAttribute("src")).toBe(HTTPS_SRC);
    editor.destroy();
  });

  it("never requests a plain http image, including after activation", () => {
    const editor = mountEditor(false, `![Legacy](${HTTP_SRC})`);
    const img = imageElements(editor)[0];
    expect(img?.getAttribute("src")).toBeNull();
    expect(screen.queryByRole("button", { name: /Load external image/ })).toBeNull();
    fireEvent.click(screen.getByText("Insecure image blocked: Legacy"));
    expect(img?.getAttribute("src")).toBeNull();
    expect(getTextEditorContent(editor, "markdown")).toContain(HTTP_SRC);
    editor.destroy();
  });

  it("still loads a drive:fn- image and does not show an external placeholder", async () => {
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:drive-image");
    const editor = mountEditor();
    await waitFor(() => {
      expect(imageElements(editor)[0]?.getAttribute("src")).toBe("blob:drive-image");
    });
    expect(createObjectURL).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Load external image/ })).toBeNull();
    expect(screen.getByText("Insecure image blocked").hidden).toBe(true);
    createObjectURL.mockRestore();
    editor.destroy();
  });

  it("remembers an https host for that editor and does not load a second host", () => {
    const sameHost = "https://cdn.example/other.png?v=2";
    const editor = mountEditor(
      false,
      `![Photo](${HTTPS_SRC})\n\n![Again](${sameHost})\n\n![Other](${OTHER_HTTPS_SRC})`,
    );
    expect(imageElements(editor).map((img) => img.getAttribute("src"))).toEqual([null, null, null]);

    fireEvent.click(
      screen.getByRole("button", { name: "Load external image: Photo (cdn.example)" }),
    );
    expect(imageElements(editor)[0]?.getAttribute("src")).toBe(HTTPS_SRC);
    expect(imageElements(editor)[1]?.getAttribute("src")).toBe(sameHost);
    expect(imageElements(editor)[2]?.getAttribute("src")).toBeNull();

    editor.commands.setContent(`![Photo](${HTTPS_SRC})`);
    expect(imageElements(editor)[0]?.getAttribute("src")).toBe(HTTPS_SRC);
    expect(screen.queryByRole("button", { name: /Load external image/ })).toBeNull();

    const fresh = mountEditor(false, `![Photo](${HTTPS_SRC})`);
    expect(imageElements(fresh)[0]?.getAttribute("src")).toBeNull();
    fresh.destroy();
    editor.destroy();
  });

  it("does not request a loopback https image until the reader opts in", () => {
    const editor = mountEditor(false, `![Secret](${LOOPBACK_SRC})`);
    expect(imageElements(editor)[0]?.getAttribute("src")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Load external image: Secret (127.0.0.1)" }),
    );
    expect(imageElements(editor)[0]?.getAttribute("src")).toBe(LOOPBACK_SRC);
    editor.destroy();
  });

  it("does not display a data url", () => {
    const editor = mountEditor(false, `![Photo](${HTTPS_SRC})`);
    const pos = findImagePos(editor);
    const node = editor.state.doc.nodeAt(pos);
    expect(node).toBeTruthy();
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(pos, undefined, {
        ...node!.attrs,
        src: "data:image/png;base64,AAAA",
      }),
    );
    expect(imageElements(editor)[0]?.getAttribute("src")).toBeNull();
    expect(screen.queryByRole("button", { name: /Load external image/ })).toBeNull();
    expect(screen.getByText("Insecure image blocked").hidden).toBe(true);
    editor.destroy();
  });

  it("serializes the https url for the clipboard without attaching that img to the live document", () => {
    const editor = mountEditor(false, `![Photo](${HTTPS_SRC})`);
    editor.commands.selectAll();
    const { dom } = editor.view.serializeForClipboard(editor.state.selection.content());
    const copied = dom.querySelector("img");
    expect(copied?.getAttribute("src")).toBe(HTTPS_SRC);
    expect(copied?.ownerDocument).not.toBe(document);
    expect(document.body.querySelector(`img[src="${HTTPS_SRC}"]`)).toBeNull();
    expect(imageElements(editor)[0]?.getAttribute("src")).toBeNull();
    editor.destroy();
  });
});

describe("docs image loading marker", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("marks a Drive image as loading for Print without the editor redrawing it", async () => {
    let finish: (blob: Blob) => void = () => {};
    const fetchImageContent = vi.fn(
      () =>
        new Promise<Blob>((resolve) => {
          finish = resolve;
        }),
    );
    const editor = new Editor({
      extensions: createTextEditorExtensions({ format: "markdown", fetchImageContent }),
      content: `![Team photo](drive:${NODE_ID})`,
    });
    document.body.append(editor.view.dom);
    const [img] = imageElements(editor);
    expect(img.dataset.loading).toBe("true");

    // Let the editor's DOM observer see the attribute: it must not rebuild the image.
    await new Promise((resolve) => setTimeout(resolve, 20));
    finish(PIXEL_PNG);
    await waitFor(() => expect(img.dataset.loading).toBeUndefined());
    expect(imageElements(editor)[0]).toBe(img);
    expect(fetchImageContent).toHaveBeenCalledTimes(1);
    editor.destroy();
  });
});
