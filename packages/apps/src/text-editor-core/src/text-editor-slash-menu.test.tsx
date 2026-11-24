/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { Editor } from "@tiptap/react";
import { describe, expect, it, vi } from "vitest";
import { createTextEditorExtensions } from "@/text-editor-core/src/text-editor-extensions";
import { TextEditorSlashMenu } from "@/text-editor-core/src/text-editor-slash-menu";

function makeEditor() {
  return new Editor({
    extensions: createTextEditorExtensions({
      format: "markdown",
      fetchImageContent: async () => new Blob(["x"], { type: "image/png" }),
    }),
    content: "<p></p>",
  });
}

describe("slash menu keyboard ownership", () => {
  it("leaves keys alone while another editor has focus", async () => {
    const a = makeEditor();
    const b = makeEditor();
    render(
      <>
        <TextEditorSlashMenu editor={a} onInsertImage={vi.fn()} />
        <TextEditorSlashMenu editor={b} onInsertImage={vi.fn()} />
      </>,
    );
    a.commands.focus("end");
    a.commands.insertContent("/");
    await screen.findAllByRole("option");

    const aFocus = vi.spyOn(a.view, "hasFocus").mockReturnValue(false);
    const bFocus = vi.spyOn(b.view, "hasFocus").mockReturnValue(true);
    const before = a.getHTML();
    const seen = vi.fn();
    b.view.dom.addEventListener("keydown", seen);

    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    b.view.dom.dispatchEvent(enter);

    // The key reaches B (the capture listener of A did not stop it); A's command did not run.
    expect(seen).toHaveBeenCalledTimes(1);
    expect(a.getHTML()).toBe(before);

    aFocus.mockRestore();
    bFocus.mockRestore();
    a.destroy();
    b.destroy();
  });

  it("closes when its editor blurs", async () => {
    const a = makeEditor();
    render(<TextEditorSlashMenu editor={a} onInsertImage={vi.fn()} />);
    a.commands.focus("end");
    a.commands.insertContent("/");
    await screen.findAllByRole("option");

    a.emit("blur", { editor: a, event: new FocusEvent("blur"), transaction: a.state.tr });
    await vi.waitFor(() => expect(screen.queryAllByRole("option")).toHaveLength(0));
    fireEvent.keyDown(document, { key: "Escape" });
    a.destroy();
  });
});
