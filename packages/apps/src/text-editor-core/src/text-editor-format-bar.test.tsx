import { render, screen } from "@testing-library/react";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/ui/tooltip";
import { TextEditorFormatBar } from "./text-editor-format-bar";

function createEditor() {
  return new Editor({
    extensions: [StarterKit],
    content: "<p>Hello world</p>",
  });
}

function renderFormatBar(ui: ReactNode) {
  return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
}

describe("TextEditorFormatBar", () => {
  it("disables formatting controls while leaving commentControl enabled", () => {
    const editor = createEditor();
    renderFormatBar(
      <TextEditorFormatBar
        editor={editor}
        showPrint={false}
        formattingDisabled
        commentControl={
          <button type="button" title="Add comment" aria-label="Add comment">
            Comment
          </button>
        }
      />,
    );

    expect((screen.getByRole("button", { name: "Bold" }) as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Heading level" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByRole("button", { name: "Link" }) as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Add comment" }) as HTMLButtonElement).disabled,
    ).toBe(false);

    editor.destroy();
  });

  it("uses outline sm IconButtons for format controls", () => {
    const editor = createEditor();
    const { container } = renderFormatBar(
      <TextEditorFormatBar editor={editor} showPrint={false} />,
    );

    const bold = screen.getByRole("button", { name: "Bold" });
    expect(bold.className).toMatch(/button--variant-outline/);
    expect(bold.className).toMatch(/icon-button--size-md/);
    expect(container.querySelector(".text-editor-format-bar__controls")).not.toBeNull();

    editor.destroy();
  });

  it("keeps Link in the quote/divider cluster without a preceding separator", () => {
    const editor = createEditor();
    renderFormatBar(<TextEditorFormatBar editor={editor} showPrint={false} />);

    const divider = screen.getByRole("button", { name: "Divider" });
    const link = screen.getByRole("button", { name: "Link" });
    let node: Element | null = divider.nextElementSibling;
    while (node && node !== link) {
      expect(node.classList.contains("text-editor-format-bar__sep")).toBe(false);
      node = node.nextElementSibling;
    }
    expect(node).toBe(link);

    editor.destroy();
  });
});
