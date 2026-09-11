/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { Editor } from "@tiptap/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { TooltipProvider } from "@/ui/tooltip";
import { DocsCollabSuggestControls } from "@/text-editor-core/docs-collab/docs-collab-suggest-controls";
import { createCollaborativeTextEditorExtensions } from "@/text-editor-core/src/text-editor-extensions";
import { getTrackChangesMode } from "@/text-editor-core/src/text-editor-track-changes";
import { docsLabels } from "@/docs-core/src/docs-labels";

const showToast = vi.fn();

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({
    show: showToast,
    dismiss: vi.fn(),
    showSuccess: vi.fn(),
    showError: vi.fn(),
  }),
}));

function createCollabEditor() {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    extensions: createCollaborativeTextEditorExtensions({
      document: ydoc,
      awareness,
      user: { id: "u1", name: "Alex", color: "#3366ff" },
      format: "markdown",
    }),
  });
}

describe("DocsCollabSuggestControls", () => {
  let editor: Editor;

  beforeEach(() => {
    showToast.mockClear();
  });

  afterEach(() => {
    editor?.destroy();
  });

  it("renders a Suggest state button with Pencil when edit (Suggest off)", async () => {
    editor = createCollabEditor();
    render(
      <TooltipProvider delayDuration={0}>
        <DocsCollabSuggestControls editor={editor} />
      </TooltipProvider>,
    );

    const toggle = screen.getByRole("button", { name: docsLabels.suggestMode });
    expect(toggle.className).toContain("docs-collab-suggest-controls");
    expect(toggle.className).not.toContain("icon-button--active");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(toggle.textContent).toContain(docsLabels.suggestMode);
    expect(toggle.querySelector("svg.lucide-pencil")).not.toBeNull();
    expect(toggle.querySelector("svg.lucide-message-square-diff")).toBeNull();
    expect(screen.queryByRole("group")).toBeNull();

    fireEvent.pointerMove(toggle);
    expect((await screen.findByRole("tooltip")).textContent).toBe(docsLabels.suggestMode);
  });

  it("toggles Suggest on/off, keeps Pencil, and toasts both ways", () => {
    editor = createCollabEditor();
    render(
      <TooltipProvider>
        <DocsCollabSuggestControls editor={editor} />
      </TooltipProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: docsLabels.suggestMode }));
    expect(getTrackChangesMode(editor)).toBe("suggest");
    expect(showToast).toHaveBeenCalledWith(docsLabels.toastSwitchedToSuggestMode);

    const pressed = screen.getByRole("button", { name: docsLabels.editMode });
    expect(pressed.className).toContain("icon-button--active");
    expect(pressed.getAttribute("aria-pressed")).toBe("true");
    expect(pressed.textContent).toContain(docsLabels.suggestMode);
    expect(pressed.textContent).not.toContain(docsLabels.editMode);
    expect(pressed.querySelector("svg.lucide-pencil")).not.toBeNull();
    expect(pressed.querySelector("svg.lucide-message-square-diff")).toBeNull();

    fireEvent.click(pressed);
    expect(getTrackChangesMode(editor)).toBe("edit");
    expect(showToast).toHaveBeenCalledWith(docsLabels.toastSwitchedToEditMode);
    const off = screen.getByRole("button", { name: docsLabels.suggestMode });
    expect(off.getAttribute("aria-pressed")).toBe("false");
    expect(off.querySelector("svg.lucide-pencil")).not.toBeNull();
  });

  it("keeps the control visible but non-interactive when disabled", () => {
    editor = createCollabEditor();
    editor.commands.setSuggestMode();
    render(
      <TooltipProvider>
        <DocsCollabSuggestControls editor={editor} disabled />
      </TooltipProvider>,
    );

    const toggle = screen.getByRole("button", { name: docsLabels.editMode });
    expect(toggle).toHaveProperty("disabled", true);
    expect(toggle.className).toContain("icon-button--active");
    fireEvent.click(toggle);
    expect(getTrackChangesMode(editor)).toBe("suggest");
    expect(showToast).not.toHaveBeenCalled();
  });
});
