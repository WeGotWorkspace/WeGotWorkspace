/** @vitest-environment jsdom */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getTextEditorContent } from "./text-editor-content";
import { createTextEditorExtensions } from "./text-editor-extensions";
import { deselectDocsImage, isDocsImageNodeSelection } from "./text-editor-image-commands";
import { DOCS_IMAGE_DELETE_LABEL } from "./text-editor-image-node-view";

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

function deleteButton(editor: Editor): HTMLButtonElement | null {
  return editor.view.dom.querySelector(
    `button[aria-label="${DOCS_IMAGE_DELETE_LABEL}"]`,
  ) as HTMLButtonElement | null;
}

function deleteHost(editor: Editor): HTMLElement | null {
  return editor.view.dom.querySelector(".text-editor-image__delete-host");
}

describe("docs image node view delete control", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("keeps the delete control available without selecting so hover can reveal it", () => {
    const editor = mountEditor();
    const button = deleteButton(editor);
    expect(editor.view.dom.querySelector(".text-editor-image")).toBeTruthy();
    expect(deleteHost(editor)?.hidden).toBe(false);
    expect(button).toBeTruthy();
    expect(isDocsImageNodeSelection(editor)).toBe(false);

    fireEvent.click(button!);
    expect(getTextEditorContent(editor, "markdown")).not.toContain(`drive:${NODE_ID}`);
    expect(editor.view.dom.querySelector(".text-editor-image")).toBeNull();
    editor.destroy();
  });

  it("shows a Delete image tooltip from the shared Tooltip primitive", async () => {
    const editor = mountEditor();
    const button = deleteButton(editor);
    expect(button).toBeTruthy();
    fireEvent.pointerMove(button!);
    fireEvent.focus(button!);
    expect(await screen.findByRole("tooltip", { name: DOCS_IMAGE_DELETE_LABEL })).toBeTruthy();
    editor.destroy();
  });

  it("keeps the delete control on a selected image and removes the node", () => {
    const editor = mountEditor();
    const wrapper = editor.view.dom.querySelector(".text-editor-image");
    editor.commands.setNodeSelection(findImagePos(editor));
    expect(wrapper?.classList.contains("ProseMirror-selectednode")).toBe(true);
    expect(deleteHost(editor)?.hidden).toBe(false);

    fireEvent.click(deleteButton(editor)!);
    expect(getTextEditorContent(editor, "markdown")).not.toContain(`drive:${NODE_ID}`);
    editor.destroy();
  });

  it("hides the delete control when the editor is read-only", () => {
    const editor = mountEditor(false);
    editor.commands.setNodeSelection(findImagePos(editor));
    expect(deleteHost(editor)?.hidden).toBe(true);
    editor.destroy();
  });

  it("clears the selected ring on Escape without removing the image", () => {
    const editor = mountEditor();
    const wrapper = editor.view.dom.querySelector(".text-editor-image");
    editor.commands.setNodeSelection(findImagePos(editor));
    expect(isDocsImageNodeSelection(editor)).toBe(true);
    expect(deselectDocsImage(editor)).toBe(true);
    expect(isDocsImageNodeSelection(editor)).toBe(false);
    expect(wrapper?.classList.contains("ProseMirror-selectednode")).toBe(false);
    expect(deleteHost(editor)?.hidden).toBe(false);
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

    fireEvent.click(screen.getByRole("button", { name: "Load external image (cdn.example)" }));
    expect(img?.getAttribute("src")).toBe(HTTPS_SRC);
    editor.destroy();
  });

  it("labels the opt-in with the host and omits URL userinfo", () => {
    const editor = mountEditor(false, `![Photo](${USERINFO_SRC})`);
    expect(imageElements(editor)[0]?.getAttribute("src")).toBeNull();
    const button = screen.getByRole("button", { name: "Load external image (cdn.example)" });
    expect(button.textContent).not.toContain("secret");
    fireEvent.click(button);
    expect(imageElements(editor)[0]?.getAttribute("src")).toBe(USERINFO_SRC);
    editor.destroy();
  });

  it("never requests a plain http image, including after activation", () => {
    const editor = mountEditor(false, `![Legacy](${HTTP_SRC})`);
    const img = imageElements(editor)[0];
    expect(img?.getAttribute("src")).toBeNull();
    expect(screen.queryByRole("button", { name: /Load external image/ })).toBeNull();
    fireEvent.click(screen.getByText("Insecure image blocked"));
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
    expect(screen.queryByText("Insecure image blocked")).toBeNull();
    createObjectURL.mockRestore();
    editor.destroy();
  });

  it("remembers an https opt-in on that document and not for other hosts or editors", () => {
    const editor = mountEditor(false, `![Photo](${HTTPS_SRC})\n\n![Other](${OTHER_HTTPS_SRC})`);
    expect(imageElements(editor)[0]?.getAttribute("src")).toBeNull();
    expect(imageElements(editor)[1]?.getAttribute("src")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Load external image (cdn.example)" }));
    expect(imageElements(editor)[0]?.getAttribute("src")).toBe(HTTPS_SRC);
    expect(imageElements(editor)[1]?.getAttribute("src")).toBeNull();

    editor.commands.setContent(`![Photo](${HTTPS_SRC})`);
    expect(imageElements(editor)[0]?.getAttribute("src")).toBe(HTTPS_SRC);
    expect(screen.queryByRole("button", { name: "Load external image (cdn.example)" })).toBeNull();

    const fresh = mountEditor(false, `![Photo](${HTTPS_SRC})`);
    expect(imageElements(fresh)[0]?.getAttribute("src")).toBeNull();
    fresh.destroy();
    editor.destroy();
  });

  it("does not request a loopback https image until the reader opts in", () => {
    const editor = mountEditor(false, `![Secret](${LOOPBACK_SRC})`);
    expect(imageElements(editor)[0]?.getAttribute("src")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Load external image (127.0.0.1)" }));
    expect(imageElements(editor)[0]?.getAttribute("src")).toBe(LOOPBACK_SRC);
    editor.destroy();
  });
});
