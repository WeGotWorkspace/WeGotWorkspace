import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen } from "@testing-library/react";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/ui/tooltip";
import { TextEditorFormatBar } from "./text-editor-format-bar";

const here = dirname(fileURLToPath(import.meta.url));
const formatBarCss = readFileSync(join(here, "text-editor.css"), "utf8");

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
    expect(bold.className).toMatch(/icon-button--size-sm/);
    expect(container.querySelector(".text-editor-format-bar__controls")).not.toBeNull();

    editor.destroy();
  });

  it("centers format controls inside equal bar padding (safe center, not a side-column grid)", () => {
    // Equal padding comes from the bar (Docs: --docs-format-chrome-padding-x).
    // Centering is inside __controls — avoid 1fr|auto|1fr which adds inset beyond padding.
    expect(formatBarCss).toMatch(/\.text-editor-format-bar \{[\s\S]*@apply flex items-center/);
    expect(formatBarCss).not.toMatch(
      /\.text-editor-format-bar \{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*auto\)\s+minmax\(0,\s*1fr\)/,
    );
    expect(formatBarCss).toMatch(/\.text-editor-format-bar__controls \{[\s\S]*justify-center/);
    expect(formatBarCss).toMatch(
      /\.text-editor-format-bar__controls \{[\s\S]*justify-content:\s*safe center/,
    );
  });

  it("scrolls overflowing format controls in one row without a visible scrollbar", () => {
    expect(formatBarCss).toMatch(/\.text-editor-format-bar__controls \{[\s\S]*flex-nowrap/);
    expect(formatBarCss).toMatch(/\.text-editor-format-bar__controls \{[\s\S]*overflow-x-auto/);
    expect(formatBarCss).toMatch(
      /\.text-editor-format-bar__controls \{[\s\S]*scrollbar-width:\s*none/,
    );
    expect(formatBarCss).toMatch(
      /\.text-editor-format-bar__controls \{[\s\S]*-ms-overflow-style:\s*none/,
    );
    expect(formatBarCss).toMatch(
      /\.text-editor-format-bar__controls::-webkit-scrollbar \{[\s\S]*display:\s*none/,
    );
  });

  it("keeps format control children from flex-shrinking below sm size", () => {
    expect(formatBarCss).toMatch(/\.text-editor-format-bar__controls\s*>\s*\*\s*\{[\s\S]*shrink-0/);
    expect(formatBarCss).toMatch(/\.text-editor-format-bar__heading-trigger \{[\s\S]*shrink-0/);
    expect(formatBarCss).toMatch(/\.text-editor-format-bar__sep \{[\s\S]*shrink-0/);
  });

  it("uses a subtle workspace-accent cream wash and header action gaps", () => {
    expect(formatBarCss).toMatch(
      /--text-editor-format-bar-wash:\s*color-mix\(\s*in oklab,\s*var\(--workspace-accent/,
    );
    expect(formatBarCss).toMatch(/--text-editor-format-bar-wash:[\s\S]*var\(--color-cream/);
    expect(formatBarCss).toMatch(/\.text-editor-format-bar__controls \{[\s\S]*gap-1\.5/);
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
