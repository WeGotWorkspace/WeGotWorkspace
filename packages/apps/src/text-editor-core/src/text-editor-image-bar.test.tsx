/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/ui/tooltip";
import { getTextEditorContent } from "./text-editor-content";
import { createTextEditorExtensions } from "./text-editor-extensions";
import { DOCS_IMAGE_LIVE_WIDTH_EVENT } from "./text-editor-image-attrs";
import { TextEditorImageBar } from "./text-editor-image-bar";

const NODE_ID = "fn-cccccccccccccccccccccccccccccccc";

function mount(editable = true) {
  const sheet = document.createElement("div");
  sheet.className = "text-editor-sheet";
  document.body.append(sheet);
  return new Editor({
    editable,
    element: sheet,
    extensions: createTextEditorExtensions({
      format: "markdown",
      fetchImageContent: vi.fn(async () => new Blob([new Uint8Array([1])])),
    }),
    content: `Before\n\n![Team](drive:${NODE_ID})\n\nAfter`,
  });
}

function imagePos(editor: Editor): number {
  let pos = -1;
  editor.state.doc.descendants((node, at) => {
    if (node.type.name === "image") pos = at;
    return pos < 0;
  });
  return pos;
}

function renderBar(editor: Editor, onReplaceImage?: (pos: number) => void) {
  return render(
    <TooltipProvider delayDuration={0}>
      <TextEditorImageBar editor={editor} onReplaceImage={onReplaceImage} />
    </TooltipProvider>,
  );
}

function openMenu(name: string) {
  const trigger = screen.getByRole("button", { name });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
}

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

describe("TextEditorImageBar", () => {
  it("shows only while an image is focused", () => {
    const editor = mount();
    renderBar(editor);
    expect(screen.queryByRole("toolbar", { name: "Image" })).toBeNull();
    act(() => void editor.commands.setNodeSelection(imagePos(editor)));
    expect(screen.getByRole("toolbar", { name: "Image" })).toBeTruthy();
    editor.destroy();
  });

  it("also shows on hover with a mouse, and lingers briefly after the pointer leaves", () => {
    vi.useFakeTimers();
    try {
      const editor = mount();
      renderBar(editor);
      const wrapper = editor.view.dom.querySelector(".text-editor-image")!;
      act(() => void wrapper.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
      expect(screen.getByRole("toolbar", { name: "Image" })).toBeTruthy();

      // Moving onto the bar keeps it.
      const bar = screen.getByRole("toolbar", { name: "Image" });
      act(() => void bar.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
      act(() => void vi.advanceTimersByTime(500));
      expect(screen.queryByRole("toolbar", { name: "Image" })).toBeTruthy();

      // Leaving for the page hides it after the grace period.
      act(() => void document.body.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
      expect(screen.queryByRole("toolbar", { name: "Image" })).toBeTruthy();
      act(() => void vi.advanceTimersByTime(300));
      expect(screen.queryByRole("toolbar", { name: "Image" })).toBeNull();
      editor.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the size live while a handle is dragged, before the width is committed", () => {
    const editor = mount();
    renderBar(editor);
    act(() => void editor.commands.setNodeSelection(imagePos(editor)));
    const wrapper = editor.view.dom.querySelector(".text-editor-image")!;
    const live = (width: number | null) =>
      act(() => {
        wrapper.dispatchEvent(
          new CustomEvent(DOCS_IMAGE_LIVE_WIDTH_EVENT, { bubbles: true, detail: { width } }),
        );
      });
    live(63);
    expect(screen.getByRole("button", { name: "Image width, 63%" })).toBeTruthy();
    expect(editor.state.doc.nodeAt(imagePos(editor))?.attrs.width).toBeNull();
    live(null);
    expect(screen.getByRole("button", { name: "Image width" })).toBeTruthy();
    editor.destroy();
  });

  it("stays while a menu of the bar is open, even if the pointer crosses a gap", () => {
    vi.useFakeTimers();
    try {
      const editor = mount();
      renderBar(editor);
      const wrapper = editor.view.dom.querySelector(".text-editor-image")!;
      act(() => void wrapper.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
      openMenu("Image width");
      expect(screen.getByRole("menu")).toBeTruthy();
      act(() => void document.body.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
      act(() => void vi.advanceTimersByTime(1000));
      // An open modal menu hides the rest from the accessibility tree: look in the DOM.
      expect(document.querySelector(".text-editor-format-bar--floating")).toBeTruthy();
      expect(screen.queryByRole("menu")).toBeTruthy();
      editor.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays away from a read-only document", () => {
    const editor = mount(false);
    renderBar(editor);
    act(() => void editor.commands.setNodeSelection(imagePos(editor)));
    expect(screen.queryByRole("toolbar", { name: "Image" })).toBeNull();
    editor.destroy();
  });

  it("sets a width from the dropdown and marks it selected", () => {
    const editor = mount();
    renderBar(editor);
    act(() => void editor.commands.setNodeSelection(imagePos(editor)));
    openMenu("Image width");
    fireEvent.click(screen.getByRole("menuitem", { name: "50%" }));
    expect(editor.state.doc.nodeAt(imagePos(editor))?.attrs.width).toBe(50);
    openMenu("Image width, 50%");
    fireEvent.click(screen.getByRole("menuitem", { name: "Full width" }));
    expect(getTextEditorContent(editor, "markdown")).toContain("width=100");
    editor.destroy();
  });

  it("shows a read-only custom entry for a dragged width", () => {
    const editor = mount();
    renderBar(editor);
    act(() => void editor.commands.setNodeSelection(imagePos(editor)));
    act(() => {
      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(imagePos(editor), undefined, {
          ...editor.state.doc.nodeAt(imagePos(editor))!.attrs,
          width: 63,
        }),
      );
    });
    openMenu("Image width, 63%");
    const custom = screen.getByRole("menuitem", { name: "Custom (63%)" });
    expect(custom.getAttribute("aria-disabled")).toBe("true");
    editor.destroy();
  });

  it("offers Replace and Remove, without icons", () => {
    const editor = mount();
    const onReplaceImage = vi.fn();
    renderBar(editor, onReplaceImage);
    act(() => void editor.commands.setNodeSelection(imagePos(editor)));
    openMenu("More image actions");
    const replace = screen.getByRole("menuitem", { name: "Replace" });
    const remove = screen.getByRole("menuitem", { name: "Remove" });
    expect(replace.querySelector("svg")).toBeNull();
    expect(remove.querySelector("svg")).toBeNull();
    fireEvent.click(replace);
    expect(onReplaceImage).toHaveBeenCalledWith(imagePos(editor));
    openMenu("More image actions");
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove" }));
    expect(editor.view.dom.querySelector(".text-editor-image")).toBeNull();
    editor.destroy();
  });
});
