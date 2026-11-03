/** @vitest-environment jsdom */
import { Editor } from "@tiptap/react";
import { Awareness } from "y-protocols/awareness";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import "@/text-editor-core/src/text-editor-track-changes-augmentation";
import { applyContentSeedToYDoc } from "@/text-editor-core/docs-collab/docs-collab-editor-surface";
import { createCollaborativeTextEditorExtensions } from "@/text-editor-core/src/text-editor-extensions";
import { getDocsTrackChangeGroups } from "@/text-editor-core/src/text-editor-track-changes";
import { setSuggestionActiveId } from "@/text-editor-core/src/text-editor-suggestion-active";

beforeEach(() => {
  document.elementFromPoint = () => null;
  document.elementsFromPoint = () => [];
});

afterEach(() => {
  document.querySelectorAll(".text-editor-prose").forEach((node) => node.remove());
});

function suggestReplaceText(editor: Editor, from: number, to: number, text: string) {
  editor.commands.setSuggestMode();
  editor.commands.setTextSelection({ from, to });
  const view = editor.view;
  const selection = view.state.selection;
  const handled = view.someProp("handleTextInput", (handler) =>
    (handler as (v: typeof view, f: number, t: number, s: string) => boolean)(
      view,
      selection.from,
      selection.to,
      text,
    ),
  );
  if (!handled) throw new Error("expected suggest-mode handleTextInput to handle replace");
}

function createReplaceEditor(seed = "Hello world") {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  applyContentSeedToYDoc(ydoc, seed, "markdown");
  const user = {
    name: "Admin",
    color: "#2563eb",
  };
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: createCollaborativeTextEditorExtensions({
      document: ydoc,
      awareness,
      trackChangesUserKey: crypto.randomUUID(),
      user,
      format: "markdown",
    }),
  });
  suggestReplaceText(editor, 6, 11, "This is a replacement");
  editor.commands.setEditMode();
  return editor;
}

function markAttrsSnapshot(editor: Editor) {
  const marks: Array<{ type: string; changeId: string | null; authorId: string | null }> = [];
  editor.state.doc.descendants((node) => {
    if (!node.isText) return;
    for (const mark of node.marks) {
      if (mark.type.name === "insertion" || mark.type.name === "deletion") {
        marks.push({
          type: mark.type.name,
          changeId: (mark.attrs.changeId as string | null) ?? null,
          authorId: (mark.attrs.authorId as string | null) ?? null,
        });
      }
    }
  });
  return marks;
}

function groupedSnapshot(editor: Editor) {
  const group = getDocsTrackChangeGroups(editor)[0];
  return {
    types: group?.parts.map((part) => part.type),
    summary: group?.summary,
  };
}

describe("text editor suggestion active", () => {
  it("setSuggestionActiveId uses decorations without stripping replace mark attrs", () => {
    const editor = createReplaceEditor();
    const changeId = getDocsTrackChangeGroups(editor)[0]!.changeId;
    const beforeMarks = markAttrsSnapshot(editor);
    const beforeGrouped = groupedSnapshot(editor);

    setSuggestionActiveId(editor, changeId);

    expect(markAttrsSnapshot(editor)).toEqual(beforeMarks);
    expect(groupedSnapshot(editor)).toEqual(beforeGrouped);
    expect(editor.view.dom.querySelector(`ins[data-change-id="${changeId}"]`)).toBeTruthy();
    expect(editor.view.dom.querySelector(`del[data-change-id="${changeId}"]`)).toBeTruthy();
    expect(editor.view.dom.querySelector("span.track-change-mark--active")).toBeTruthy();

    editor.destroy();
  });

  it("editor blur after activation does not strip replace mark attrs", () => {
    const editor = createReplaceEditor();
    editor.commands.setTextSelection({ from: 8, to: 8 });
    editor.commands.focus();
    const changeId = getDocsTrackChangeGroups(editor)[0]!.changeId;
    const beforeMarks = markAttrsSnapshot(editor);

    setSuggestionActiveId(editor, changeId);

    const composer = document.createElement("input");
    document.body.appendChild(composer);
    composer.focus();

    expect(markAttrsSnapshot(editor)).toEqual(beforeMarks);
    expect(groupedSnapshot(editor).summary).toContain("Replace");
    expect(groupedSnapshot(editor).types).toContain("deletion");

    composer.remove();
    editor.destroy();
  });
});
