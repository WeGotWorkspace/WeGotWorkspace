import { render, screen } from "@testing-library/react";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { TextEditorFormatBar } from "./text-editor-format-bar";

function createEditor() {
  return new Editor({
    extensions: [StarterKit],
    content: "<p>Hello world</p>",
  });
}

describe("TextEditorFormatBar", () => {
  it("disables formatting controls while leaving commentControl enabled", () => {
    const editor = createEditor();
    render(
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

    expect((screen.getByTitle("Bold") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTitle("Heading level") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTitle("Link") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTitle("Add comment") as HTMLButtonElement).disabled).toBe(false);

    editor.destroy();
  });
});
