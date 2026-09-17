/**
 * @vitest-environment jsdom
 */
import type { ReactElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/ui/tooltip";
import { TextEditorFormatBar } from "@/text-editor-core/src/text-editor-format-bar";
import { createTextEditorExtensions } from "@/text-editor-core/src/text-editor-extensions";
import { insertDocsImageFromNodeId } from "@/text-editor-core/src/text-editor-image-commands";
import { getTextEditorContent } from "@/text-editor-core/src/text-editor-content";
import { setDocsImageUploadHandler } from "@/text-editor-core/src/text-editor-image-paste";
import { TextEditorSlashMenu } from "@/text-editor-core/src/text-editor-slash-menu";

const NODE_ID = "fn-dddddddddddddddddddddddddddddddd";

function renderWithTooltip(ui: ReactElement) {
  return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
}

describe("docs image insert UI", () => {
  it("opens the picker from the format toolbar", async () => {
    const editor = new Editor({
      extensions: [StarterKit],
      content: "<p>Hello</p>",
    });
    const onInsertImage = vi.fn();
    renderWithTooltip(
      <TextEditorFormatBar editor={editor} showPrint={false} onInsertImage={onInsertImage} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Insert image" }));
    expect(onInsertImage).toHaveBeenCalledTimes(1);
    editor.destroy();
  });

  it("offers Image in the slash menu and inserts a drive:fn- ref", async () => {
    const onInsertImage = vi.fn();
    const editor = new Editor({
      extensions: createTextEditorExtensions({
        format: "markdown",
        fetchImageContent: async () => new Blob(["x"], { type: "image/png" }),
      }),
      content: "<p></p>",
    });
    render(<TextEditorSlashMenu editor={editor} onInsertImage={onInsertImage} />);
    editor.commands.focus("end");
    editor.commands.insertContent("/");

    fireEvent.mouseDown(await screen.findByRole("option", { name: /Image/i }));
    expect(onInsertImage).toHaveBeenCalledTimes(1);

    insertDocsImageFromNodeId(editor, NODE_ID, "Diagram");
    expect(getTextEditorContent(editor, "markdown")).toContain(`![Diagram](drive:${NODE_ID})`);
    editor.destroy();
  });

  it("uploads pasted image files then setImage", async () => {
    const editor = new Editor({
      extensions: createTextEditorExtensions({
        format: "markdown",
        fetchImageContent: async () => new Blob(["x"], { type: "image/png" }),
      }),
      content: "<p></p>",
    });
    const upload = vi.fn(async (files: File[]) => {
      expect(files).toHaveLength(1);
      insertDocsImageFromNodeId(editor, NODE_ID, "pasted");
    });
    setDocsImageUploadHandler(editor, upload);

    const file = new File([new Uint8Array([1, 2, 3])], "paste.png", { type: "image/png" });
    const data = {
      files: [file],
      getData: () => "",
    } as unknown as DataTransfer;
    const event = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, "clipboardData", { value: data });
    Object.defineProperty(event, "preventDefault", { value: vi.fn() });

    const handled = editor.view.someProp("handlePaste", (handler) =>
      handler(editor.view, event, editor.state.selection.content()),
    );
    expect(handled).toBe(true);
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(getTextEditorContent(editor, "markdown")).toContain(`![pasted](drive:${NODE_ID})`);
    editor.destroy();
  });
});
