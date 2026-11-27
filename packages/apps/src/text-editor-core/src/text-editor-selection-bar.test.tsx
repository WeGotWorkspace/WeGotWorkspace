/** @vitest-environment jsdom */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/ui/tooltip";
import { createTextEditorExtensions } from "./text-editor-extensions";
import { TextEditorFormatBar } from "./text-editor-format-bar";
import { TextEditorSelectionBar } from "./text-editor-selection-bar";

function mount(editable = true) {
  const sheet = document.createElement("div");
  sheet.className = "text-editor-sheet";
  document.body.append(sheet);
  const editor = new Editor({
    editable,
    element: sheet,
    extensions: createTextEditorExtensions({ format: "markdown" }),
    content: "Hello brave world",
  });
  // jsdom has no layout: give the coordinates a selection would have.
  vi.spyOn(editor.view, "coordsAtPos").mockImplementation((pos) => ({
    left: 10 * pos,
    right: 10 * pos,
    top: 200,
    bottom: 220,
  }));
  vi.spyOn(editor, "isFocused", "get").mockReturnValue(true);
  return editor;
}

function renderBar(editor: Editor) {
  return render(
    <TooltipProvider delayDuration={0}>
      <TextEditorSelectionBar
        editor={editor}
        render={(floating) => <TextEditorFormatBar editor={editor} floating={floating} />}
      />
    </TooltipProvider>,
  );
}

const bar = () => document.querySelector(".text-editor-format-bar--floating");

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("TextEditorSelectionBar", () => {
  it("shows over selected text and hangs off the middle of it", async () => {
    const editor = mount();
    renderBar(editor);
    expect(bar()).toBeNull();
    act(() => void editor.commands.setTextSelection({ from: 2, to: 8 }));
    await waitFor(() => expect(bar()).toBeTruthy());
    expect(bar()?.getAttribute("data-anchor")).toBe("center");
    expect(bar()?.getAttribute("data-placement")).toBe("above");
    expect(screen.getByRole("button", { name: /bold/i })).toBeTruthy();
    editor.destroy();
  });

  it("goes away when the selection collapses to a caret", async () => {
    const editor = mount();
    renderBar(editor);
    act(() => void editor.commands.setTextSelection({ from: 2, to: 8 }));
    await waitFor(() => expect(bar()).toBeTruthy());
    act(() => void editor.commands.setTextSelection(4));
    await waitFor(() => expect(bar()).toBeNull());
    editor.destroy();
  });

  it("stays away from a read-only document", async () => {
    const editor = mount(false);
    renderBar(editor);
    act(() => void editor.commands.setTextSelection({ from: 2, to: 8 }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(bar()).toBeNull();
    editor.destroy();
  });

  it("drops below the selection when there is no room above", async () => {
    const editor = mount();
    vi.spyOn(editor.view, "coordsAtPos").mockReturnValue({
      left: 50,
      right: 50,
      top: 20,
      bottom: 40,
    });
    renderBar(editor);
    act(() => void editor.commands.setTextSelection({ from: 2, to: 8 }));
    await waitFor(() => expect(bar()?.getAttribute("data-placement")).toBe("below"));
    editor.destroy();
  });
});
