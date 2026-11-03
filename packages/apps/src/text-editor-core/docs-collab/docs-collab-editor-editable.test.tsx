/** @vitest-environment jsdom */
import { act, render, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { describe, expect, it, vi } from "vitest";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { DocsCollabEditor } from "@/text-editor-core/docs-collab/docs-collab-editor";
import { applyContentSeedToYDoc } from "@/text-editor-core/docs-collab/docs-collab-editor-surface";

// #1787: Docs keeps the editor read-only while the file's access loads, then
// makes it editable. The save hook reads every content report as a possible
// edit, so a report on that switch marked the loaded local copy dirty. The
// join bootstrap then saw "unsaved work" and asked about an outside write
// instead of showing it.
describe("DocsCollabEditor editable switch", () => {
  it("does not report a content change when only editability changes", async () => {
    const ydoc = new Y.Doc();
    applyContentSeedToYDoc(ydoc, "Typed over all of it");
    const awareness = new Awareness(ydoc);
    const user = { name: "Alex", color: "#336699" };
    const onContentChange = vi.fn();
    let editor: Editor | null = null;
    const renderEditor = (editable: boolean) => (
      <DocsCollabEditor
        ydoc={ydoc}
        awareness={awareness}
        user={user}
        trackChangesUserKey="alex:"
        editable={editable}
        autofocus={false}
        formatBar={false}
        onContentChange={onContentChange}
        onEditorReady={(next) => {
          editor = next;
        }}
      />
    );

    const view = render(renderEditor(false));
    await waitFor(() => expect(editor?.getText()).toContain("Typed over all of it"));
    onContentChange.mockClear();

    view.rerender(renderEditor(true));
    await waitFor(() => expect(editor?.isEditable).toBe(true));
    expect(onContentChange).not.toHaveBeenCalled();

    // A real edit still reports.
    act(() => {
      editor?.commands.insertContent(" more");
    });
    expect(onContentChange).toHaveBeenCalled();
    view.unmount();
  });
});
