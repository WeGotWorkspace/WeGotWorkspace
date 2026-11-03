/** @vitest-environment jsdom */
import { render, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import { describe, expect, it } from "vitest";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { DocsCollabEditor } from "@/text-editor-core/docs-collab/docs-collab-editor";
import {
  editorHasTrackChanges,
  getTrackChangesMode,
  getTrackChangesPendingCount,
} from "@/text-editor-core/src/text-editor-track-changes";

// #1738: a change to a `useEditor` dep (here `trackChangesUserKey`, which the
// Docs workspace builds from the room once it is known) makes TipTap destroy
// the editor and build a new one. Code that still holds the old instance for
// one render must not throw.
describe("DocsCollabEditor rebuild", () => {
  it("survives a key change while effects and callers still hold the old editor", async () => {
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    const seen: Editor[] = [];
    const onEditorReady = (editor: Editor | null) => {
      if (!editor) return;
      seen.push(editor);
      // What the workspace does with the editor it gets.
      editorHasTrackChanges(editor);
      getTrackChangesMode(editor);
      getTrackChangesPendingCount(editor);
    };
    const renderEditor = (key: string) => (
      <DocsCollabEditor
        ydoc={ydoc}
        awareness={awareness}
        // A new object each render, as the session hands it over.
        user={{ name: "Alex", color: "#336699" }}
        trackChangesUserKey={key}
        onEditorReady={onEditorReady}
        formatBar={false}
      />
    );

    const view = render(renderEditor("alex:"));
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    const first = seen[seen.length - 1]!;

    view.rerender(renderEditor("alex:room-1"));
    await waitFor(() => expect(seen[seen.length - 1]).not.toBe(first));
    view.rerender(renderEditor("alex:room-1"));

    expect(first.isDestroyed).toBe(true);
    expect(editorHasTrackChanges(first)).toBe(false);
    expect(getTrackChangesMode(first)).toBe("edit");
    expect(getTrackChangesPendingCount(first)).toBe(0);
    const live = seen[seen.length - 1]!;
    expect(editorHasTrackChanges(live)).toBe(true);
    expect(view.container.querySelector(".ProseMirror")).not.toBeNull();
    view.unmount();
  });
});
