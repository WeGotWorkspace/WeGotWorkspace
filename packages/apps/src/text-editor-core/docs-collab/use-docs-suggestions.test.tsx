/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { Editor } from "@tiptap/react";
import { Awareness } from "y-protocols/awareness";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { docsLabels } from "@/docs-core/src/docs-labels";
import { TooltipProvider } from "@/ui/tooltip";
import "@/text-editor-core/src/text-editor-track-changes-augmentation";
import { applyContentSeedToYDoc } from "./docs-collab-editor-surface";
import { getDocsSuggestionThreadsMap } from "./docs-suggestions-map";
import { DocsSuggestionCard } from "./docs-suggestions/docs-suggestion-card";
import { createCollaborativeTextEditorExtensions } from "@/text-editor-core/src/text-editor-extensions";
import * as trackChanges from "@/text-editor-core/src/text-editor-track-changes";
import {
  getDocsTrackChangeGroups,
  trackChangesAuthorIdFromName,
} from "@/text-editor-core/src/text-editor-track-changes";
import { useDocsSuggestions } from "./use-docs-suggestions";

beforeEach(() => {
  document.elementFromPoint = () => null;
  document.elementsFromPoint = () => [];
});

afterEach(() => {
  cleanup();
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

function createCollabEditor(ydoc: Y.Doc, awareness: Awareness) {
  applyContentSeedToYDoc(ydoc, "Hello world", "markdown");
  const user = {
    id: trackChangesAuthorIdFromName("Alex"),
    name: "Alex",
    color: "#2563eb",
  };
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: createCollaborativeTextEditorExtensions({
      document: ydoc,
      awareness,
      user,
      format: "markdown",
    }),
  });
  editor.commands.setTextSelection({ from: 6, to: 6 });
  suggestInsertText(editor, "!");
  return editor;
}

function createReplaceEditor(ydoc: Y.Doc, awareness: Awareness) {
  applyContentSeedToYDoc(ydoc, "Hello world", "markdown");
  const user = {
    id: trackChangesAuthorIdFromName("Alex"),
    name: "Alex",
    color: "#2563eb",
  };
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: createCollaborativeTextEditorExtensions({
      document: ydoc,
      awareness,
      user,
      format: "markdown",
    }),
  });
  suggestReplaceText(editor, 6, 11, "everyone");
  return editor;
}

describe("useDocsSuggestions", () => {
  it("does not prune persisted threads before editor track changes are readable", () => {
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    getDocsSuggestionThreadsMap(ydoc).set("orphan-key", {
      messages: [],
      reactions: [{ emoji: "👍", userIds: ["u-1"] }],
    });

    const editor = createCollabEditor(ydoc, awareness);
    const changeId = getDocsTrackChangeGroups(editor)[0]?.changeId;
    expect(changeId).toBeTruthy();

    getDocsSuggestionThreadsMap(ydoc).set(changeId!, {
      messages: [],
      reactions: [{ emoji: "👀", userIds: ["u-1"] }],
    });

    renderHook(() =>
      useDocsSuggestions(editor, {
        ydoc,
        currentUser: { id: "u-1", name: "Alex" },
      }),
    );

    expect(getDocsSuggestionThreadsMap(ydoc).has(changeId!)).toBe(true);
    expect(getDocsSuggestionThreadsMap(ydoc).get(changeId!)).toMatchObject({
      reactions: [{ emoji: "👀", userIds: ["u-1"] }],
    });
    expect(getDocsSuggestionThreadsMap(ydoc).has("orphan-key")).toBe(false);

    editor.destroy();
  });

  it("persists reactions through toggleReaction", () => {
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    const editor = createCollabEditor(ydoc, awareness);
    const changeId = getDocsTrackChangeGroups(editor)[0]?.changeId;
    expect(changeId).toBeTruthy();

    const { result } = renderHook(() =>
      useDocsSuggestions(editor, {
        ydoc,
        currentUser: { id: "u-1", name: "Alex" },
      }),
    );

    act(() => {
      result.current.toggleReaction(changeId!, "👍");
    });

    expect(getDocsSuggestionThreadsMap(ydoc).get(changeId!)).toMatchObject({
      reactions: [{ emoji: "👍", userIds: ["u-1"] }],
    });
    expect(result.current.suggestions[0]?.reactions).toEqual([{ emoji: "👍", userIds: ["u-1"] }]);

    editor.destroy();
  });

  it("keeps replace diff after selecting a replace suggestion", () => {
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    const editor = createReplaceEditor(ydoc, awareness);
    const changeId = getDocsTrackChangeGroups(editor)[0]?.changeId;
    expect(changeId).toBeTruthy();

    const { result } = renderHook(() =>
      useDocsSuggestions(editor, {
        ydoc,
        currentUser: { id: "u-1", name: "Alex" },
      }),
    );

    act(() => {
      result.current.selectSuggestion(changeId!);
    });

    const suggestion = result.current.suggestions.find((item) => item.changeId === changeId);
    expect(suggestion?.parts.some((part) => part.type === "deletion")).toBe(true);
    expect(suggestion?.parts.some((part) => part.type === "insertion")).toBe(true);
    expect(suggestion?.summary).toContain("Replace");
    expect(suggestion?.authorName).toBe("Alex");

    editor.destroy();
  });

  it("keeps replace diff after activating from a document mark click", () => {
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    const editor = createReplaceEditor(ydoc, awareness);
    editor.commands.setEditMode();
    const changeId = getDocsTrackChangeGroups(editor)[0]?.changeId;
    expect(changeId).toBeTruthy();

    const { result } = renderHook(() =>
      useDocsSuggestions(editor, {
        ydoc,
        currentUser: { id: "u-1", name: "Alex" },
      }),
    );

    act(() => {
      result.current.activateSuggestionFromMark(changeId!);
    });

    const suggestion = result.current.suggestions.find((item) => item.changeId === changeId);
    expect(suggestion?.parts.some((part) => part.type === "deletion")).toBe(true);
    expect(suggestion?.parts.some((part) => part.type === "insertion")).toBe(true);
    expect(suggestion?.summary).toContain("Replace");
    expect(suggestion?.authorName).toBe("Alex");
    expect(result.current.activeChangeId).toBe(changeId);

    const insAfter = editor.view.dom.querySelector("ins[data-change-id]");
    expect(insAfter?.getAttribute("data-change-id")).toBe(changeId);

    editor.destroy();
  });

  it("keeps suggestion card text in sync while typing in suggest mode", () => {
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    applyContentSeedToYDoc(ydoc, "Hello", "markdown");
    const user = {
      id: trackChangesAuthorIdFromName("Alex"),
      name: "Alex",
      color: "#2563eb",
    };
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = new Editor({
      element,
      extensions: createCollaborativeTextEditorExtensions({
        document: ydoc,
        awareness,
        user,
        format: "markdown",
      }),
    });

    editor.commands.setTextSelection({ from: 6, to: 6 });
    const { result } = renderHook(() =>
      useDocsSuggestions(editor, {
        ydoc,
        currentUser: { id: "u-1", name: "Alex" },
      }),
    );

    for (const char of "world") {
      act(() => {
        suggestInsertText(editor, char);
      });
    }

    const suggestion = result.current.suggestions[0];
    expect(suggestion?.parts.find((part) => part.type === "insertion")?.text).toBe("world");
    expect(suggestion?.summary).toContain("world");

    editor.destroy();
  });

  it("keeps replace diff with link after clicking the suggestion card", () => {
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    const user = {
      id: trackChangesAuthorIdFromName("Alex"),
      name: "Alex",
      color: "#2563eb",
    };
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = new Editor({
      element,
      extensions: createCollaborativeTextEditorExtensions({
        document: ydoc,
        awareness,
        user,
        format: "markdown",
      }),
    });
    editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Visit " },
            {
              type: "text",
              marks: [{ type: "link", attrs: { href: "https://example.com" } }],
              text: "example",
            },
            { type: "text", text: " now" },
          ],
        },
      ],
    });

    suggestReplaceText(editor, 7, 14, "site");
    editor.commands.setEditMode();
    editor.commands.setTextSelection({ from: 8, to: 8 });
    editor.commands.focus();

    const changeId = getDocsTrackChangeGroups(editor)[0]?.changeId;
    expect(changeId).toBeTruthy();

    const { result } = renderHook(() =>
      useDocsSuggestions(editor, {
        ydoc,
        currentUser: { id: "u-1", name: "Alex" },
      }),
    );

    const suggestion = result.current.suggestions.find((item) => item.changeId === changeId);
    expect(suggestion).toBeTruthy();

    render(
      <TooltipProvider delayDuration={0}>
        <DocsSuggestionCard
          suggestion={suggestion!}
          labels={docsLabels}
          currentUserId="u-1"
          active={false}
          onSelect={() => result.current.selectSuggestion(changeId!)}
          onAccept={() => {}}
          onReject={() => {}}
          onAddReply={() => {}}
          onToggleReaction={() => {}}
        />
      </TooltipProvider>,
    );

    act(() => {
      fireEvent.mouseDown(screen.getByLabelText(suggestion!.summary));
      fireEvent.click(screen.getByLabelText(suggestion!.summary));
    });

    const selected = result.current.suggestions.find((item) => item.changeId === changeId);
    expect(selected?.parts.some((part) => part.type === "deletion")).toBe(true);
    expect(selected?.parts.some((part) => part.type === "insertion")).toBe(true);
    expect(selected?.summary).toContain("Replace");
    expect(selected?.parts.find((part) => part.type === "deletion")?.text).toContain("example");

    let linkInDeletion = false;
    editor.state.doc.descendants((node) => {
      if (
        node.isText &&
        node.marks.some((mark) => mark.type.name === "deletion") &&
        node.marks.some((mark) => mark.type.name === "link")
      ) {
        linkInDeletion = true;
      }
    });
    expect(linkInDeletion).toBe(true);

    editor.destroy();
  });

  it("selectSuggestion only updates sidebar active state without touching the editor", () => {
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    const editor = createReplaceEditor(ydoc, awareness);
    editor.commands.setEditMode();
    editor.commands.focus();
    const changeId = getDocsTrackChangeGroups(editor)[0]?.changeId;
    expect(changeId).toBeTruthy();

    const beforeJson = JSON.stringify(editor.getJSON());
    const scrollSpy = vi.spyOn(trackChanges, "scrollTrackChangeIntoView");

    const { result } = renderHook(() =>
      useDocsSuggestions(editor, {
        ydoc,
        currentUser: { id: "u-1", name: "Admin" },
      }),
    );

    act(() => {
      result.current.selectSuggestion(changeId!);
    });

    act(() => {
      const composer = document.createElement("input");
      document.body.appendChild(composer);
      composer.focus();
      composer.remove();
    });

    expect(result.current.activeChangeId).toBe(changeId);
    expect(JSON.stringify(editor.getJSON())).toBe(beforeJson);
    expect(scrollSpy).not.toHaveBeenCalled();

    const suggestion = result.current.suggestions.find((item) => item.changeId === changeId);
    expect(suggestion?.parts.some((part) => part.type === "deletion")).toBe(true);
    expect(suggestion?.parts.some((part) => part.type === "insertion")).toBe(true);
    expect(suggestion?.summary).toContain("Replace");
    expect(suggestion?.authorName).toBe("Alex");
    expect(editor.view.dom.querySelector(`ins[data-change-id="${changeId}"]`)).toBeTruthy();
    expect(editor.view.dom.querySelector(`del[data-change-id="${changeId}"]`)).toBeTruthy();

    scrollSpy.mockRestore();
    editor.destroy();
  });

  it("activates a suggestion for reply composer visibility", () => {
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    const editor = createCollabEditor(ydoc, awareness);
    const changeId = getDocsTrackChangeGroups(editor)[0]?.changeId;
    expect(changeId).toBeTruthy();

    const { result } = renderHook(() =>
      useDocsSuggestions(editor, {
        ydoc,
        currentUser: { id: "u-1", name: "Alex" },
      }),
    );

    expect(result.current.activeChangeId).toBeNull();

    act(() => {
      result.current.selectSuggestion(changeId!);
    });

    expect(result.current.activeChangeId).toBe(changeId);

    editor.destroy();
  });
});
