/** @vitest-environment jsdom */
import { Editor } from "@tiptap/react";
import "@/text-editor-core/src/text-editor-track-changes-augmentation";
import { beforeEach, describe, expect, it } from "vitest";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { getTrackedChanges } from "tiptap-track-changes";
import { applyContentSeedToYDoc } from "../docs-collab/docs-collab-editor-surface";
import { createCollaborativeTextEditorExtensions } from "./text-editor-extensions";
import {
  getAcceptedTextEditorContent,
  getDocsTrackChangeGroups,
  getTrackChangeIdFromTarget,
  getTrackChangesMode,
  getTrackChangesPendingCount,
  scrollTrackChangeIntoView,
} from "./text-editor-track-changes";
import { setSuggestionActiveId } from "./text-editor-suggestion-active";
import { syncPersistedCommentMarks } from "./text-editor-comment-commands";

beforeEach(() => {
  document.elementFromPoint = () => null;
  document.elementsFromPoint = () => [];
});

function suggestInsertText(editor: Editor, text: string) {
  editor.commands.setSuggestMode();
  const view = editor.view;
  const { from, to } = view.state.selection;
  const handled = view.someProp("handleTextInput", (handler) =>
    (handler as (v: typeof view, f: number, t: number, s: string) => boolean)(view, from, to, text),
  );
  if (!handled) {
    const tr = editor.state.tr.insertText(text, from, to);
    tr.setMeta("uiEvent", "input");
    editor.view.dispatch(tr);
  }
}

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
  if (!handled) {
    throw new Error("expected suggest-mode handleTextInput to handle replace");
  }
}

function createCollabEditor(
  ydoc: Y.Doc,
  awareness: Awareness,
  user: { name: string; color: string },
  seedText: string | null = "Hello world",
) {
  if (seedText != null) {
    applyContentSeedToYDoc(ydoc, seedText, "markdown");
  }
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    extensions: createCollaborativeTextEditorExtensions({
      document: ydoc,
      awareness,
      trackChangesUserKey: crypto.randomUUID(),
      user,
      format: "markdown",
    }),
  });
}

describe("text editor track changes", () => {
  it("defaults to edit mode and toggles suggest mode", () => {
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    const user = {
      name: "Alex",
      color: "#2563eb",
    };
    const editor = createCollabEditor(ydoc, awareness, user);

    expect(getTrackChangesMode(editor)).toBe("edit");
    editor.commands.setSuggestMode();
    expect(getTrackChangesMode(editor)).toBe("suggest");
    editor.commands.setEditMode();
    expect(getTrackChangesMode(editor)).toBe("edit");

    editor.destroy();
  });

  it("tracks insertions in suggest mode", () => {
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    const user = {
      name: "Alex",
      color: "#2563eb",
    };
    const editor = createCollabEditor(ydoc, awareness, user);

    editor.commands.setTextSelection({ from: 13, to: 13 });
    suggestInsertText(editor, "!");

    expect(getTrackChangesPendingCount(editor)).toBeGreaterThan(0);
    expect(getAcceptedTextEditorContent(editor, "text")).toBe("Hello world");

    editor.destroy();
  });

  it("accepts and rejects suggestions at the cursor and in bulk", () => {
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    const user = {
      name: "Alex",
      color: "#2563eb",
    };
    const editor = createCollabEditor(ydoc, awareness, user, "Hello");

    editor.commands.setTextSelection({ from: 6, to: 6 });
    suggestInsertText(editor, " world");
    const changeId = getTrackedChanges(editor)[0]?.changeId;
    expect(changeId).toBeTruthy();

    editor.commands.acceptChange(changeId!);
    expect(getTrackChangesPendingCount(editor)).toBe(0);
    expect(editor.getText()).toContain("Hello world");

    editor.commands.setTextSelection({ from: 11, to: 11 });
    suggestInsertText(editor, "!");
    const rejectId = getTrackedChanges(editor)[0]?.changeId;
    editor.commands.rejectChange(rejectId!);
    expect(getTrackChangesPendingCount(editor)).toBe(0);
    expect(editor.getText()).not.toContain("Hello world!");

    editor.commands.setTextSelection({ from: 6, to: 6 });
    suggestInsertText(editor, " again");
    editor.commands.acceptAll();
    expect(getTrackChangesPendingCount(editor)).toBe(0);
    expect(editor.getText()).toContain("Hello again");

    editor.destroy();
  });

  it("keeps data-change-id when scrolling to a replace insertion without focusing the editor", () => {
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    const user = {
      name: "Alex",
      color: "#2563eb",
    };
    const editor = createCollabEditor(ydoc, awareness, user, "Hello world");

    suggestReplaceText(editor, 6, 11, "everyone");
    editor.commands.setEditMode();

    const changeId = getDocsTrackChangeGroups(editor)[0]!.changeId;

    setSuggestionActiveId(editor, changeId);
    scrollTrackChangeIntoView(editor, changeId);

    const insAfter = editor.view.dom.querySelector(`ins[data-change-id="${changeId}"]`);
    expect(insAfter?.getAttribute("data-change-id")).toBe(changeId);

    editor.destroy();
  });

  it("keeps replace parts when activating from insertion mark in edit mode", () => {
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    const user = {
      name: "Alex",
      color: "#2563eb",
    };
    const editor = createCollabEditor(ydoc, awareness, user, "Hello world");

    suggestReplaceText(editor, 6, 11, "everyone");
    editor.commands.setEditMode();

    const before = getDocsTrackChangeGroups(editor)[0]!;
    const insertionMark = editor.view.dom.querySelector(
      "ins[data-change-id]",
    ) as HTMLElement | null;
    expect(insertionMark).toBeTruthy();

    const changeId = getTrackChangeIdFromTarget(insertionMark)!;
    expect(changeId).toBe(before.changeId);

    setSuggestionActiveId(editor, changeId);
    scrollTrackChangeIntoView(editor, changeId);

    const after = getDocsTrackChangeGroups(editor).find((group) => group.changeId === changeId);
    expect(after?.parts.some((part) => part.type === "deletion")).toBe(true);
    expect(after?.parts.some((part) => part.type === "insertion")).toBe(true);
    expect(after?.summary).toContain("Replace");

    const insAfter = editor.view.dom.querySelector("ins[data-change-id]");
    expect(insAfter?.getAttribute("data-change-id")).toBe(changeId);

    editor.destroy();
  });

  it("shows full insertion text when typing character by character in suggest mode", () => {
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    const user = {
      name: "Alex",
      color: "#2563eb",
    };
    const editor = createCollabEditor(ydoc, awareness, user, "Hello");

    editor.commands.setTextSelection({ from: 6, to: 6 });
    const summaries: string[] = [];
    for (const char of "world") {
      suggestInsertText(editor, char);
      summaries.push(getDocsTrackChangeGroups(editor)[0]?.summary ?? "");
    }

    expect(summaries).toEqual([
      "Insert “w”",
      "Insert “wo”",
      "Insert “wor”",
      "Insert “worl”",
      "Insert “world”",
    ]);

    editor.destroy();
  });

  it("groups pending track changes for the suggestions sidebar", () => {
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    const user = {
      name: "Alex",
      color: "#2563eb",
    };
    const editor = createCollabEditor(ydoc, awareness, user, "Hello");

    editor.commands.setTextSelection({ from: 6, to: 6 });
    suggestInsertText(editor, " world");

    const groups = getDocsTrackChangeGroups(editor);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.summary).toContain("world");
    // Who made it is not in the document; the review panel takes it from the thread.
    expect(groups[0]).not.toHaveProperty("authorName");

    editor.destroy();
  });

  it("accepts a suggestion and exports accepted markdown", () => {
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    const user = {
      name: "Alex",
      color: "#2563eb",
    };
    const editor = createCollabEditor(ydoc, awareness, user);

    editor.commands.setTextSelection({ from: 13, to: 13 });
    suggestInsertText(editor, "!");

    expect(getTrackChangesPendingCount(editor)).toBeGreaterThan(0);
    expect(getAcceptedTextEditorContent(editor, "markdown")).not.toContain("!");

    editor.commands.acceptAll();
    expect(getTrackChangesPendingCount(editor)).toBe(0);
    expect(getAcceptedTextEditorContent(editor, "text")).toContain("Hello world!");

    editor.destroy();
  });

  it("syncs pending suggestions between two editors on one Y.Doc", () => {
    const ydoc = new Y.Doc();
    const awareness1 = new Awareness(ydoc);
    const awareness2 = new Awareness(ydoc);
    const user1 = {
      name: "Alex",
      color: "#2563eb",
    };
    const user2 = {
      name: "Bob",
      color: "#dc2626",
    };

    const editor1 = createCollabEditor(ydoc, awareness1, user1);
    const editor2 = createCollabEditor(ydoc, awareness2, user2, null);

    editor1.commands.setTextSelection({ from: 13, to: 13 });
    suggestInsertText(editor1, "!");

    expect(getTrackChangesPendingCount(editor2)).toBeGreaterThan(0);
    expect(getAcceptedTextEditorContent(editor2, "text")).toBe("Hello world");

    editor1.destroy();
    editor2.destroy();
  });

  it("does not track comment mark application in suggest mode", () => {
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    const user = {
      name: "Alex",
      color: "#2563eb",
    };
    const editor = createCollabEditor(ydoc, awareness, user);

    editor.commands.setSuggestMode();
    editor.commands.setTextSelection({ from: 7, to: 12 });

    const beforeCount = getDocsTrackChangeGroups(editor).length;

    expect(
      syncPersistedCommentMarks(editor, [
        {
          id: "c-1",
          anchorText: "world",
          resolved: false,
          messages: [{ id: "m-1" }],
        },
      ]),
    ).toBe(true);

    expect(getDocsTrackChangeGroups(editor)).toHaveLength(beforeCount);
    expect(editor.getHTML()).toContain('data-comment-id="c-1"');

    editor.destroy();
  });
});
