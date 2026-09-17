/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fireEvent, screen } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { docsLabels } from "@/docs-core/src/docs-labels";
import { getTextEditorContent } from "./text-editor-content";
import { createTextEditorExtensions } from "./text-editor-extensions";
import { deselectDocsImage, isDocsImageNodeSelection } from "./text-editor-image-commands";
import { DOCS_IMAGE_DELETE_LABEL } from "./text-editor-image-node-view";

const NODE_ID = "fn-cccccccccccccccccccccccccccccccc";
const PIXEL_PNG = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
const here = dirname(fileURLToPath(import.meta.url));
const nodeViewSource = readFileSync(join(here, "text-editor-image-node-view.ts"), "utf8");
const deleteControlSource = readFileSync(
  join(here, "text-editor-image-delete-control.tsx"),
  "utf8",
);

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

function mountEditor(editable = true): Editor {
  const editor = new Editor({
    editable,
    extensions: createTextEditorExtensions({
      format: "markdown",
      fetchImageContent: vi.fn(async () => PIXEL_PNG),
    }),
    content: `Before\n\n![Team photo](drive:${NODE_ID})\n\nAfter`,
  });
  document.body.append(editor.view.dom);
  return editor;
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

  it("uses IconButton tooltip + Trash2, not title= or a close/X", () => {
    expect(DOCS_IMAGE_DELETE_LABEL).toBe("Delete image");
    expect(docsLabels.deleteImage).toBe(DOCS_IMAGE_DELETE_LABEL);
    expect(deleteControlSource).toMatch(/IconButton/);
    expect(deleteControlSource).toMatch(/TooltipProvider/);
    expect(deleteControlSource).toMatch(/<Trash2/);
    expect(deleteControlSource).not.toMatch(/title=/);
    expect(nodeViewSource).not.toMatch(/title=\{?DOCS_IMAGE_DELETE_LABEL/);
    expect(deleteControlSource).not.toMatch(/M18 6 6 18/);
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
