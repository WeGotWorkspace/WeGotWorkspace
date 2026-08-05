/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Awareness } from "y-protocols/awareness";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import "@/text-editor-core/src/text-editor-track-changes-augmentation";
import { CommentMark } from "@/text-editor-core/src/text-editor-comment-commands";
import {
  COMMENT_DRAFT_ANCHOR_CLASS,
  CommentDraftAnchor,
} from "@/text-editor-core/src/text-editor-comment-draft-anchor";
import { createCollaborativeTextEditorExtensions } from "@/text-editor-core/src/text-editor-extensions";
import {
  getDocsTrackChangeGroups,
  trackChangesAuthorIdFromName,
} from "@/text-editor-core/src/text-editor-track-changes";
import { applyContentSeedToYDoc } from "./docs-collab-editor-surface";
import { getDocsCommentsMap, useDocsComments } from "./use-docs-comments";
import { useDocsSuggestions } from "./use-docs-suggestions";

function createEditor(content = "<p>Hello world</p>") {
  return new Editor({
    extensions: [StarterKit.configure({ undoRedo: false }), CommentMark, CommentDraftAnchor],
    content,
  });
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
  return new Editor({
    element,
    extensions: createCollaborativeTextEditorExtensions({
      document: ydoc,
      awareness,
      user,
      format: "markdown",
    }),
  });
}

afterEach(() => {
  cleanup();
});

describe("useDocsComments", () => {
  it("syncs persisted threads from the Y.Map but hides empty drafts", () => {
    const ydoc = new Y.Doc();
    const map = getDocsCommentsMap(ydoc);
    map.set("t-1", {
      id: "t-1",
      anchorText: "world",
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: { id: "u-1", name: "Alex" },
      resolved: false,
      messages: [],
    });
    map.set("t-2", {
      id: "t-2",
      anchorText: "world",
      createdAt: "2026-01-02T00:00:00.000Z",
      createdBy: { id: "u-1", name: "Alex" },
      resolved: false,
      messages: [
        {
          id: "m-1",
          body: "Note",
          createdAt: "2026-01-02T00:01:00.000Z",
          author: { id: "u-1", name: "Alex" },
        },
      ],
    });

    const { result } = renderHook(() =>
      useDocsComments({
        ydoc,
        editor: null,
        currentUser: { id: "u-1", name: "Alex" },
      }),
    );

    expect(result.current.threads).toHaveLength(2);
    expect(result.current.openThreads).toHaveLength(1);
    expect(result.current.openThreads[0]?.id).toBe("t-2");
  });

  it("does not offer compose when comments are not visible but allows explicit draft creation", () => {
    const ydoc = new Y.Doc();
    const editor = createEditor();
    editor.commands.setTextSelection({ from: 7, to: 12 });

    const { result } = renderHook(() =>
      useDocsComments({
        ydoc,
        editor,
        currentUser: { id: "u-1", name: "Alex" },
        commentsVisible: false,
      }),
    );

    expect(result.current.canAddComment).toBe(false);
    expect(result.current.selectionQualifiesForComment).toBe(true);

    let threadId: string | null = null;
    act(() => {
      threadId = result.current.createThreadFromSelection();
    });

    expect(threadId).not.toBeNull();
    expect(result.current.draftThread).not.toBeNull();
    expect(result.current.activeThreadId).toBe(threadId);
    editor.destroy();
  });

  it("cancels draft when comments become hidden", () => {
    const ydoc = new Y.Doc();
    const editor = createEditor();
    editor.commands.setTextSelection({ from: 1, to: 6 });

    const { result, rerender } = renderHook(
      ({ commentsVisible }: { commentsVisible: boolean }) =>
        useDocsComments({
          ydoc,
          editor,
          currentUser: { id: "u-1", name: "Alex" },
          commentsVisible,
        }),
      { initialProps: { commentsVisible: true } },
    );

    act(() => {
      result.current.createThreadFromSelection();
    });

    expect(result.current.draftThread).not.toBeNull();

    rerender({ commentsVisible: false });

    expect(result.current.draftThread).toBeNull();
    expect(result.current.activeThreadId).toBeNull();
    expect(editor.view.dom.querySelector(`.${COMMENT_DRAFT_ANCHOR_CLASS}`)).toBeNull();
    editor.destroy();
  });

  it("clears active thread when comments become hidden", () => {
    const ydoc = new Y.Doc();
    const editor = createEditor(
      '<p>Hello <span data-comment-id="t-1" class="comment-mark">world</span>!</p>',
    );
    getDocsCommentsMap(ydoc).set("t-1", {
      id: "t-1",
      anchorText: "world",
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: { id: "u-1", name: "Alex" },
      resolved: false,
      messages: [
        {
          id: "m-1",
          body: "First",
          createdAt: "2026-01-01T00:01:00.000Z",
          author: { id: "u-1", name: "Alex" },
        },
      ],
    });

    const { result, rerender } = renderHook(
      ({ commentsVisible }: { commentsVisible: boolean }) =>
        useDocsComments({
          ydoc,
          editor,
          currentUser: { id: "u-1", name: "Alex" },
          commentsVisible,
        }),
      { initialProps: { commentsVisible: true } },
    );

    act(() => {
      result.current.selectThread("t-1");
    });

    expect(result.current.activeThreadId).toBe("t-1");
    expect(editor.view.dom.querySelector(".comment-mark--active")).not.toBeNull();

    rerender({ commentsVisible: false });

    expect(result.current.activeThreadId).toBeNull();
    expect(editor.view.dom.querySelector(".comment-mark--active")).toBeNull();
    editor.destroy();
  });

  it("does not activate comment marks from selection when comments are not visible", () => {
    const ydoc = new Y.Doc();
    const editor = createEditor(
      '<p>Hello <span data-comment-id="t-1" class="comment-mark">world</span>!</p>',
    );
    getDocsCommentsMap(ydoc).set("t-1", {
      id: "t-1",
      anchorText: "world",
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: { id: "u-1", name: "Alex" },
      resolved: false,
      messages: [
        {
          id: "m-1",
          body: "First",
          createdAt: "2026-01-01T00:01:00.000Z",
          author: { id: "u-1", name: "Alex" },
        },
      ],
    });

    const { result } = renderHook(() =>
      useDocsComments({
        ydoc,
        editor,
        currentUser: { id: "u-1", name: "Alex" },
        commentsVisible: false,
      }),
    );

    act(() => {
      editor.commands.setTextSelection({ from: 7, to: 12 });
    });

    expect(result.current.canAddComment).toBe(false);
    expect(result.current.draftThread).toBeNull();
    expect(result.current.activeThreadId).toBeNull();
    editor.destroy();
  });

  it("creates a draft thread without a comment mark until the first reply", () => {
    const ydoc = new Y.Doc();
    const editor = createEditor();
    editor.commands.setTextSelection({ from: 7, to: 12 });

    const { result } = renderHook(() =>
      useDocsComments({
        ydoc,
        editor,
        currentUser: { id: "u-1", name: "Alex" },
      }),
    );

    let threadId: string | null = null;
    act(() => {
      threadId = result.current.createThreadFromSelection();
    });

    expect(threadId).toBeTruthy();
    expect(getDocsCommentsMap(ydoc).size).toBe(0);
    expect(editor.getHTML()).not.toContain("data-comment-id");
    expect(result.current.activeThreadId).toBe(threadId);
    expect(result.current.draftThread?.id).toBe(threadId);
    expect(result.current.draftThread?.anchorFrom).toBe(7);
    expect(result.current.draftThread?.anchorTo).toBe(12);
    expect(result.current.draftThread?.anchorOccurrence).toBe(0);
    expect(result.current.openThreads).toHaveLength(0);
    expect(editor.view.dom.querySelector(`.${COMMENT_DRAFT_ANCHOR_CLASS}`)).not.toBeNull();
    expect(editor.getHTML()).not.toContain("comment-mark");
    editor.destroy();
  });

  it("shows draft anchor selection styling while composer has focus", () => {
    const ydoc = new Y.Doc();
    const editor = createEditor();
    editor.commands.setTextSelection({ from: 7, to: 12 });

    const { result } = renderHook(() =>
      useDocsComments({
        ydoc,
        editor,
        currentUser: { id: "u-1", name: "Alex" },
      }),
    );

    act(() => {
      result.current.createThreadFromSelection();
    });

    const textarea = document.createElement("textarea");
    const layer = document.createElement("div");
    layer.className = "docs-comments-floating-layer";
    layer.appendChild(textarea);
    document.body.appendChild(layer);

    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 1 });
      textarea.focus();
    });

    expect(result.current.draftThread).not.toBeNull();
    expect(editor.view.dom.querySelector(`.${COMMENT_DRAFT_ANCHOR_CLASS}`)).not.toBeNull();
    expect(editor.view.dom.querySelector(".comment-mark")).toBeNull();

    layer.remove();
    editor.destroy();
  });

  it("removes draft anchor styling when draft is canceled or submitted", () => {
    const ydoc = new Y.Doc();
    const editor = createEditor();
    editor.commands.setTextSelection({ from: 7, to: 12 });

    const { result } = renderHook(() =>
      useDocsComments({
        ydoc,
        editor,
        currentUser: { id: "u-1", name: "Alex" },
      }),
    );

    act(() => {
      result.current.createThreadFromSelection();
    });

    expect(result.current.draftThread).not.toBeNull();

    act(() => {
      result.current.cancelDraft();
    });

    expect(result.current.draftThread).toBeNull();
    expect(editor.view.dom.querySelector(`.${COMMENT_DRAFT_ANCHOR_CLASS}`)).toBeNull();
    editor.destroy();
  });

  it("cancelDraft clears the draft and collapses selection so compose does not reopen", () => {
    const ydoc = new Y.Doc();
    const editor = createEditor();
    editor.commands.setTextSelection({ from: 7, to: 12 });

    const { result } = renderHook(() =>
      useDocsComments({
        ydoc,
        editor,
        currentUser: { id: "u-1", name: "Alex" },
      }),
    );

    act(() => {
      result.current.createThreadFromSelection();
    });

    expect(result.current.draftThread).not.toBeNull();

    act(() => {
      result.current.cancelDraft();
    });

    expect(result.current.draftThread).toBeNull();
    expect(result.current.activeThreadId).toBeNull();
    expect(getDocsCommentsMap(ydoc).size).toBe(0);
    expect(editor.getHTML()).not.toContain("data-comment-id");
    expect(editor.state.selection.empty).toBe(true);
    expect(result.current.canAddComment).toBe(false);
    editor.destroy();
  });

  it("cancels draft threads when the editor selection moves away", async () => {
    const ydoc = new Y.Doc();
    const editor = createEditor();
    editor.commands.setTextSelection({ from: 7, to: 12 });

    const { result } = renderHook(() =>
      useDocsComments({
        ydoc,
        editor,
        currentUser: { id: "u-1", name: "Alex" },
      }),
    );

    act(() => {
      result.current.createThreadFromSelection();
    });

    await act(async () => {
      editor.commands.focus();
      editor.commands.setTextSelection({ from: 1, to: 1 });
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(getDocsCommentsMap(ydoc).size).toBe(0);
    expect(result.current.openThreads).toHaveLength(0);
    expect(result.current.activeThreadId).toBeNull();
    expect(editor.getHTML()).not.toContain("data-comment-id");
    expect(editor.view.dom.querySelector(`.${COMMENT_DRAFT_ANCHOR_CLASS}`)).toBeNull();
    editor.destroy();
  });

  it("persists a thread and applies the comment mark when the first reply is submitted", () => {
    const ydoc = new Y.Doc();
    const editor = createEditor();
    editor.commands.setTextSelection({ from: 7, to: 12 });

    const { result } = renderHook(() =>
      useDocsComments({
        ydoc,
        editor,
        currentUser: { id: "u-1", name: "Alex" },
      }),
    );

    let threadId: string | null = null;
    act(() => {
      threadId = result.current.createThreadFromSelection();
    });

    expect(editor.getHTML()).not.toContain("data-comment-id");

    act(() => {
      result.current.addReply(threadId!, "Looks good");
    });

    expect(getDocsCommentsMap(ydoc).size).toBe(1);
    const thread = getDocsCommentsMap(ydoc).get(threadId!) as { messages: { body: string }[] };
    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0]?.body).toBe("Looks good");
    expect(result.current.openThreads).toHaveLength(1);
    expect(editor.getHTML()).toContain(`data-comment-id="${threadId}"`);
    expect(editor.view.dom.querySelector(`.${COMMENT_DRAFT_ANCHOR_CLASS}`)).toBeNull();
    editor.destroy();
  });

  it("does not activate comment marks when keyboard caret traverses through them", async () => {
    const ydoc = new Y.Doc();
    const editor = createEditor(
      '<p>Hello <span data-comment-id="t-1" class="comment-mark">world</span>!</p>',
    );
    getDocsCommentsMap(ydoc).set("t-1", {
      id: "t-1",
      anchorText: "world",
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: { id: "u-1", name: "Alex" },
      resolved: false,
      messages: [
        {
          id: "m-1",
          body: "First",
          createdAt: "2026-01-01T00:01:00.000Z",
          author: { id: "u-1", name: "Alex" },
        },
      ],
    });

    const { result, unmount } = renderHook(() =>
      useDocsComments({
        ydoc,
        editor,
        currentUser: { id: "u-1", name: "Alex" },
      }),
    );

    await act(async () => {
      editor.commands.setTextSelection({ from: 6, to: 6 });
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(result.current.activeThreadId).toBeNull();
    expect(editor.view.dom.querySelector(".comment-mark--active")).toBeNull();

    await act(async () => {
      editor.commands.setTextSelection({ from: 9, to: 9 });
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(result.current.activeThreadId).toBeNull();
    expect(editor.view.dom.querySelector(".comment-mark--active")).toBeNull();

    await act(async () => {
      editor.commands.setTextSelection({ from: 13, to: 13 });
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(result.current.activeThreadId).toBeNull();
    expect(editor.view.dom.querySelector(".comment-mark--active")).toBeNull();
    unmount();
    editor.destroy();
  });

  it("does not offer compose when selecting an existing comment mark", () => {
    const ydoc = new Y.Doc();
    const editor = createEditor(
      '<p>Hello <span data-comment-id="t-1" class="comment-mark">world</span>!</p>',
    );
    getDocsCommentsMap(ydoc).set("t-1", {
      id: "t-1",
      anchorText: "world",
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: { id: "u-1", name: "Alex" },
      resolved: false,
      messages: [
        {
          id: "m-1",
          body: "First",
          createdAt: "2026-01-01T00:01:00.000Z",
          author: { id: "u-1", name: "Alex" },
        },
      ],
    });

    const { result } = renderHook(() =>
      useDocsComments({
        ydoc,
        editor,
        currentUser: { id: "u-1", name: "Alex" },
      }),
    );

    act(() => {
      editor.commands.setTextSelection({ from: 7, to: 12 });
    });

    expect(result.current.canAddComment).toBe(false);
    expect(result.current.draftThread).toBeNull();
    expect(result.current.activeThreadId).toBe("t-1");
    expect(editor.state.selection.empty).toBe(true);
    editor.destroy();
  });

  it("adds replies and resolves threads while hiding resolved marks", () => {
    const ydoc = new Y.Doc();
    const editor = createEditor(
      '<p>Hello <span data-comment-id="t-1" class="comment-mark">world</span></p>',
    );
    getDocsCommentsMap(ydoc).set("t-1", {
      id: "t-1",
      anchorText: "world",
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: { id: "u-1", name: "Alex" },
      resolved: false,
      messages: [
        {
          id: "m-1",
          body: "First",
          createdAt: "2026-01-01T00:01:00.000Z",
          author: { id: "u-1", name: "Alex" },
        },
      ],
    });

    const { result } = renderHook(() =>
      useDocsComments({
        ydoc,
        editor,
        currentUser: { id: "u-2", name: "Sam" },
      }),
    );

    act(() => {
      result.current.addReply("t-1", "Looks good");
    });

    const thread = getDocsCommentsMap(ydoc).get("t-1") as { messages: { body: string }[] };
    expect(thread.messages).toHaveLength(2);
    expect(thread.messages[1]?.body).toBe("Looks good");

    act(() => {
      result.current.resolveThread("t-1");
    });

    const resolved = getDocsCommentsMap(ydoc).get("t-1") as { resolved: boolean };
    expect(resolved.resolved).toBe(true);
    expect(result.current.openThreads).toHaveLength(0);
    expect(editor.getHTML()).not.toContain("data-comment-id");
    editor.destroy();
  });

  it("clears active thread on click outside comment UI", () => {
    const ydoc = new Y.Doc();
    const editor = createEditor(
      '<p>Hello <span data-comment-id="t-1" class="comment-mark">world</span> there</p>',
    );
    getDocsCommentsMap(ydoc).set("t-1", {
      id: "t-1",
      anchorText: "world",
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: { id: "u-1", name: "Alex" },
      resolved: false,
      messages: [
        {
          id: "m-1",
          body: "First",
          createdAt: "2026-01-01T00:01:00.000Z",
          author: { id: "u-1", name: "Alex" },
        },
      ],
    });

    const { result, unmount } = renderHook(() =>
      useDocsComments({
        ydoc,
        editor,
        currentUser: { id: "u-1", name: "Alex" },
      }),
    );

    act(() => {
      result.current.selectThread("t-1");
    });

    expect(result.current.activeThreadId).toBe("t-1");
    expect(editor.view.dom.querySelector(".comment-mark--active")).not.toBeNull();

    act(() => {
      document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
      document.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(result.current.activeThreadId).toBeNull();
    expect(editor.view.dom.querySelector(".comment-mark--active")).toBeNull();
    unmount();
    editor.destroy();
  });

  it("deselect stays deselected after outside click before selection settles", async () => {
    const ydoc = new Y.Doc();
    const editor = createEditor(
      '<p>Hello <span data-comment-id="t-1" class="comment-mark">world</span> there</p>',
    );
    getDocsCommentsMap(ydoc).set("t-1", {
      id: "t-1",
      anchorText: "world",
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: { id: "u-1", name: "Alex" },
      resolved: false,
      messages: [
        {
          id: "m-1",
          body: "First",
          createdAt: "2026-01-01T00:01:00.000Z",
          author: { id: "u-1", name: "Alex" },
        },
      ],
    });

    const { result, unmount } = renderHook(() =>
      useDocsComments({
        ydoc,
        editor,
        currentUser: { id: "u-1", name: "Alex" },
      }),
    );

    act(() => {
      result.current.selectThread("t-1");
    });

    expect(result.current.activeThreadId).toBe("t-1");

    await act(async () => {
      document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
      window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      document.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(result.current.activeThreadId).toBeNull();

    await act(async () => {
      editor.commands.setTextSelection({ from: 13, to: 13 });
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(result.current.activeThreadId).toBeNull();
    expect(editor.view.dom.querySelector(".comment-mark--active")).toBeNull();
    unmount();
    editor.destroy();
  });

  it("keeps active thread when pointerdown hits comment UI", () => {
    const ydoc = new Y.Doc();
    const editor = createEditor(
      '<p>Hello <span data-comment-id="t-1" class="comment-mark">world</span> there</p>',
    );
    getDocsCommentsMap(ydoc).set("t-1", {
      id: "t-1",
      anchorText: "world",
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: { id: "u-1", name: "Alex" },
      resolved: false,
      messages: [
        {
          id: "m-1",
          body: "First",
          createdAt: "2026-01-01T00:01:00.000Z",
          author: { id: "u-1", name: "Alex" },
        },
      ],
    });

    const { result, unmount } = renderHook(() =>
      useDocsComments({
        ydoc,
        editor,
        currentUser: { id: "u-1", name: "Alex" },
      }),
    );

    act(() => {
      result.current.selectThread("t-1");
    });

    const mark = editor.view.dom.querySelector('[data-comment-id="t-1"]');
    expect(mark).not.toBeNull();

    act(() => {
      mark!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    });

    expect(result.current.activeThreadId).toBe("t-1");

    const layer = document.createElement("div");
    layer.className = "docs-comments-floating-layer";
    document.body.appendChild(layer);

    act(() => {
      layer.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    });

    expect(result.current.activeThreadId).toBe("t-1");
    layer.remove();
    unmount();
    editor.destroy();
  });

  it("keeps active comment mark styling after editor updates", () => {
    const ydoc = new Y.Doc();
    const editor = createEditor(
      '<p>Hello <span data-comment-id="t-1" class="comment-mark">world</span></p>',
    );
    getDocsCommentsMap(ydoc).set("t-1", {
      id: "t-1",
      anchorText: "world",
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: { id: "u-1", name: "Alex" },
      resolved: false,
      messages: [
        {
          id: "m-1",
          body: "First",
          createdAt: "2026-01-01T00:01:00.000Z",
          author: { id: "u-1", name: "Alex" },
        },
      ],
    });

    const { result } = renderHook(() =>
      useDocsComments({
        ydoc,
        editor,
        currentUser: { id: "u-1", name: "Alex" },
      }),
    );

    act(() => {
      result.current.selectThread("t-1");
    });

    expect(editor.view.dom.querySelector(".comment-mark--active")).not.toBeNull();

    act(() => {
      editor.commands.setTextSelection({ from: 13, to: 13 });
      editor.commands.insertContent("!");
    });

    expect(result.current.activeThreadId).toBe("t-1");
    expect(editor.view.dom.querySelector(".comment-mark--active")).not.toBeNull();
    editor.destroy();
  });

  it("re-applies comment marks when threads load without editor highlights", () => {
    const ydoc = new Y.Doc();
    const editor = createEditor("<p>Hello world</p>");
    getDocsCommentsMap(ydoc).set("t-1", {
      id: "t-1",
      anchorText: "world",
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: { id: "u-1", name: "Alex" },
      resolved: false,
      messages: [
        {
          id: "m-1",
          body: "Note",
          createdAt: "2026-01-01T00:01:00.000Z",
          author: { id: "u-1", name: "Alex" },
        },
      ],
    });

    renderHook(() =>
      useDocsComments({
        ydoc,
        editor,
        currentUser: { id: "u-1", name: "Alex" },
      }),
    );

    expect(editor.getHTML()).toContain('data-comment-id="t-1"');
    editor.destroy();
  });

  it("deletes threads and removes comment marks", () => {
    const ydoc = new Y.Doc();
    const editor = createEditor(
      '<p>Hello <span data-comment-id="t-1" class="comment-mark">world</span></p>',
    );
    getDocsCommentsMap(ydoc).set("t-1", {
      id: "t-1",
      anchorText: "world",
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: { id: "u-1", name: "Alex" },
      resolved: false,
      messages: [
        {
          id: "m-1",
          body: "Note",
          createdAt: "2026-01-01T00:01:00.000Z",
          author: { id: "u-1", name: "Alex" },
        },
      ],
    });

    const { result } = renderHook(() =>
      useDocsComments({
        ydoc,
        editor,
        currentUser: { id: "u-1", name: "Alex" },
      }),
    );

    act(() => {
      result.current.deleteThread("t-1");
    });

    expect(getDocsCommentsMap(ydoc).size).toBe(0);
    expect(editor.getHTML()).not.toContain("data-comment-id");
    editor.destroy();
  });

  it("toggles thread-level emoji reactions for the current user", () => {
    const ydoc = new Y.Doc();
    getDocsCommentsMap(ydoc).set("t-1", {
      id: "t-1",
      anchorText: "world",
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: { id: "u-1", name: "Alex" },
      resolved: false,
      messages: [
        {
          id: "m-1",
          body: "Note",
          createdAt: "2026-01-01T00:01:00.000Z",
          author: { id: "u-1", name: "Alex" },
        },
      ],
    });

    const { result } = renderHook(() =>
      useDocsComments({
        ydoc,
        editor: null,
        currentUser: { id: "u-2", name: "Sam" },
      }),
    );

    act(() => {
      result.current.toggleReaction("t-1", "👍");
    });

    let thread = getDocsCommentsMap(ydoc).get("t-1") as {
      reactions?: { emoji: string; userIds: string[] }[];
    };
    expect(thread.reactions).toEqual([{ emoji: "👍", userIds: ["u-2"] }]);
    expect(result.current.openThreads[0]?.reactions).toEqual([{ emoji: "👍", userIds: ["u-2"] }]);

    act(() => {
      result.current.toggleReaction("t-1", "👍");
    });

    thread = getDocsCommentsMap(ydoc).get("t-1") as {
      reactions?: { emoji: string; userIds: string[] }[];
    };
    expect(thread.reactions).toBeUndefined();

    act(() => {
      result.current.toggleReaction("t-1", "👍");
      result.current.toggleReaction("t-1", "💡");
    });

    thread = getDocsCommentsMap(ydoc).get("t-1") as {
      reactions?: { emoji: string; userIds: string[] }[];
    };
    expect(thread.reactions).toEqual([
      { emoji: "👍", userIds: ["u-2"] },
      { emoji: "💡", userIds: ["u-2"] },
    ]);
  });

  it("activateThreadFromMark applies active styling via mark click path", () => {
    const ydoc = new Y.Doc();
    const editor = createEditor(
      '<p>Hello <span data-comment-id="t-1" class="comment-mark">world</span>!</p>',
    );
    getDocsCommentsMap(ydoc).set("t-1", {
      id: "t-1",
      anchorText: "world",
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: { id: "u-1", name: "Alex" },
      resolved: false,
      messages: [
        {
          id: "m-1",
          body: "First",
          createdAt: "2026-01-01T00:01:00.000Z",
          author: { id: "u-1", name: "Alex" },
        },
      ],
    });

    const { result } = renderHook(() =>
      useDocsComments({
        ydoc,
        editor,
        currentUser: { id: "u-1", name: "Alex" },
      }),
    );

    act(() => {
      result.current.activateThreadFromMark("t-1", 9);
    });

    expect(result.current.activeThreadId).toBe("t-1");
    expect(editor.view.dom.querySelector(".comment-mark--active")).not.toBeNull();
    expect(editor.state.selection.empty).toBe(true);
    expect(editor.state.selection.from).toBe(9);
    editor.destroy();
  });

  it("selectThread from floating card moves caret to mark start when editor is elsewhere", () => {
    const ydoc = new Y.Doc();
    const editor = createEditor(
      '<p>Hello <span data-comment-id="t-2" class="comment-mark">world</span>!</p>',
    );
    getDocsCommentsMap(ydoc).set("t-2", {
      id: "t-2",
      anchorText: "world",
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: { id: "u-1", name: "Alex" },
      resolved: false,
      messages: [
        {
          id: "m-1",
          body: "Note",
          createdAt: "2026-01-01T00:01:00.000Z",
          author: { id: "u-1", name: "Alex" },
        },
      ],
    });

    const { result } = renderHook(() =>
      useDocsComments({
        ydoc,
        editor,
        currentUser: { id: "u-1", name: "Alex" },
      }),
    );

    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 1 });
      result.current.selectThread("t-2");
    });

    expect(result.current.activeThreadId).toBe("t-2");
    const active = editor.view.dom.querySelector(".comment-mark--active");
    expect(active?.getAttribute("data-comment-id")).toBe("t-2");
    expect(editor.state.selection.empty).toBe(true);
    expect(editor.state.selection.from).toBe(7);
    editor.destroy();
  });

  it("selectThread preserves caret when already inside the mark", () => {
    const ydoc = new Y.Doc();
    const editor = createEditor(
      '<p>Hello <span data-comment-id="t-2" class="comment-mark">world</span>!</p>',
    );
    getDocsCommentsMap(ydoc).set("t-2", {
      id: "t-2",
      anchorText: "world",
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: { id: "u-1", name: "Alex" },
      resolved: false,
      messages: [
        {
          id: "m-1",
          body: "Note",
          createdAt: "2026-01-01T00:01:00.000Z",
          author: { id: "u-1", name: "Alex" },
        },
      ],
    });

    const { result } = renderHook(() =>
      useDocsComments({
        ydoc,
        editor,
        currentUser: { id: "u-1", name: "Alex" },
      }),
    );

    act(() => {
      editor.commands.setTextSelection({ from: 9, to: 9 });
      result.current.selectThread("t-2");
    });

    expect(result.current.activeThreadId).toBe("t-2");
    expect(editor.state.selection.from).toBe(9);
    editor.destroy();
  });

  it("re-applies active styling when re-selecting the same comment text", async () => {
    const ydoc = new Y.Doc();
    const editor = createEditor(
      '<p>Hello <span data-comment-id="t-1" class="comment-mark">world</span>!</p>',
    );
    getDocsCommentsMap(ydoc).set("t-1", {
      id: "t-1",
      anchorText: "world",
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: { id: "u-1", name: "Alex" },
      resolved: false,
      messages: [
        {
          id: "m-1",
          body: "First",
          createdAt: "2026-01-01T00:01:00.000Z",
          author: { id: "u-1", name: "Alex" },
        },
      ],
    });

    const { result } = renderHook(() =>
      useDocsComments({
        ydoc,
        editor,
        currentUser: { id: "u-1", name: "Alex" },
      }),
    );

    act(() => {
      result.current.selectThread("t-1");
    });

    editor.view.dom.querySelector(".comment-mark")?.classList.remove("comment-mark--active");
    expect(editor.view.dom.querySelector(".comment-mark--active")).toBeNull();

    await act(async () => {
      editor.commands.setTextSelection({ from: 7, to: 12 });
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(result.current.activeThreadId).toBe("t-1");
    expect(editor.state.selection.empty).toBe(true);
    expect(editor.state.selection.from).toBe(7);
    expect(editor.view.dom.querySelector(".comment-mark--active")).not.toBeNull();
    editor.destroy();
  });

  it("activates the correct thread when multiple comment marks are adjacent", async () => {
    const ydoc = new Y.Doc();
    const editor = createEditor(
      '<p><span data-comment-id="t-a" class="comment-mark">Hello</span> <span data-comment-id="t-b" class="comment-mark">world</span>!</p>',
    );
    for (const [id, anchorText] of [
      ["t-a", "Hello"],
      ["t-b", "world"],
    ] as const) {
      getDocsCommentsMap(ydoc).set(id, {
        id,
        anchorText,
        createdAt: "2026-01-01T00:00:00.000Z",
        createdBy: { id: "u-1", name: "Alex" },
        resolved: false,
        messages: [
          {
            id: `m-${id}`,
            body: "Note",
            createdAt: "2026-01-01T00:01:00.000Z",
            author: { id: "u-1", name: "Alex" },
          },
        ],
      });
    }

    const { result } = renderHook(() =>
      useDocsComments({
        ydoc,
        editor,
        currentUser: { id: "u-1", name: "Alex" },
      }),
    );

    await act(async () => {
      editor.commands.setTextSelection({ from: 7, to: 12 });
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(result.current.activeThreadId).toBe("t-b");
    expect(editor.state.selection.empty).toBe(true);
    expect(editor.state.selection.from).toBe(7);
    expect(
      editor.view.dom.querySelector('.comment-mark--active[data-comment-id="t-b"]'),
    ).not.toBeNull();

    await act(async () => {
      editor.commands.setTextSelection({ from: 1, to: 6 });
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(result.current.activeThreadId).toBe("t-a");
    expect(editor.state.selection.empty).toBe(true);
    expect(editor.state.selection.from).toBe(1);
    expect(
      editor.view.dom.querySelector('.comment-mark--active[data-comment-id="t-a"]'),
    ).not.toBeNull();
    editor.destroy();
  });

  it("selectThread switches active mark styling from first to second comment card", async () => {
    const ydoc = new Y.Doc();
    const editor = createEditor(
      '<p>Hello <span data-comment-id="t-1" class="comment-mark">world</span> <span data-comment-id="t-2" class="comment-mark">there</span></p>',
    );
    for (const id of ["t-1", "t-2"]) {
      getDocsCommentsMap(ydoc).set(id, {
        id,
        anchorText: id === "t-1" ? "world" : "there",
        anchorFrom: id === "t-1" ? 7 : 13,
        anchorTo: id === "t-1" ? 12 : 18,
        createdAt: "2026-01-01T00:00:00.000Z",
        createdBy: { id: "u-1", name: "Alex" },
        resolved: false,
        messages: [
          {
            id: `m-${id}`,
            body: "Note",
            createdAt: "2026-01-01T00:01:00.000Z",
            author: { id: "u-1", name: "Alex" },
          },
        ],
      });
    }

    const { result } = renderHook(() =>
      useDocsComments({
        ydoc,
        editor,
        currentUser: { id: "u-1", name: "Alex" },
      }),
    );

    act(() => {
      result.current.selectThread("t-1");
    });

    expect(
      editor.view.dom.querySelector('.comment-mark--active[data-comment-id="t-1"]'),
    ).not.toBeNull();

    await act(async () => {
      result.current.selectThread("t-2");
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(result.current.activeThreadId).toBe("t-2");
    expect(
      editor.view.dom.querySelector('.comment-mark--active[data-comment-id="t-1"]'),
    ).toBeNull();
    expect(
      editor.view.dom.querySelector('.comment-mark--active[data-comment-id="t-2"]'),
    ).not.toBeNull();
    editor.destroy();
  });

  it("cycles active mark styling A -> B -> A via selectThread", async () => {
    const ydoc = new Y.Doc();
    const editor = createEditor(
      '<p>Hello <span data-comment-id="t-a" class="comment-mark">world</span> <span data-comment-id="t-b" class="comment-mark">there</span></p>',
    );
    for (const [id, anchorText] of [
      ["t-a", "world"],
      ["t-b", "there"],
    ] as const) {
      getDocsCommentsMap(ydoc).set(id, {
        id,
        anchorText,
        createdAt: "2026-01-01T00:00:00.000Z",
        createdBy: { id: "u-1", name: "Alex" },
        resolved: false,
        messages: [
          {
            id: `m-${id}`,
            body: "Note",
            createdAt: "2026-01-01T00:01:00.000Z",
            author: { id: "u-1", name: "Alex" },
          },
        ],
      });
    }

    const { result } = renderHook(() =>
      useDocsComments({
        ydoc,
        editor,
        currentUser: { id: "u-1", name: "Alex" },
      }),
    );

    const expectActive = (activeId: string, inactiveId: string) => {
      expect(result.current.activeThreadId).toBe(activeId);
      expect(
        editor.view.dom.querySelector(`.comment-mark--active[data-comment-id="${activeId}"]`),
      ).not.toBeNull();
      expect(
        editor.view.dom.querySelector(`.comment-mark--active[data-comment-id="${inactiveId}"]`),
      ).toBeNull();
    };

    act(() => {
      result.current.selectThread("t-a");
    });
    expectActive("t-a", "t-b");

    await act(async () => {
      result.current.selectThread("t-b");
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expectActive("t-b", "t-a");

    await act(async () => {
      result.current.selectThread("t-a");
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expectActive("t-a", "t-b");
    editor.destroy();
  });

  it("does not clear active mark when pointerdown retargets away from comment span", async () => {
    const ydoc = new Y.Doc();
    const editor = createEditor(
      '<p>Hello <span data-comment-id="t-1" class="comment-mark">world</span> <span data-comment-id="t-2" class="comment-mark">there</span></p>',
    );
    for (const id of ["t-1", "t-2"]) {
      getDocsCommentsMap(ydoc).set(id, {
        id,
        anchorText: id === "t-1" ? "world" : "there",
        createdAt: "2026-01-01T00:00:00.000Z",
        createdBy: { id: "u-1", name: "Alex" },
        resolved: false,
        messages: [
          {
            id: `m-${id}`,
            body: "Note",
            createdAt: "2026-01-01T00:01:00.000Z",
            author: { id: "u-1", name: "Alex" },
          },
        ],
      });
    }

    const { result, unmount } = renderHook(() =>
      useDocsComments({
        ydoc,
        editor,
        currentUser: { id: "u-1", name: "Alex" },
      }),
    );

    act(() => {
      result.current.selectThread("t-1");
    });

    const mark2 = editor.view.dom.querySelector('[data-comment-id="t-2"]') as HTMLElement | null;
    const paragraph = editor.view.dom.querySelector("p");
    expect(mark2).not.toBeNull();
    expect(paragraph).not.toBeNull();

    const rect = mark2!.getBoundingClientRect();
    await act(async () => {
      const event = new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + 2,
        clientY: rect.top + rect.height / 2,
      });
      Object.defineProperty(event, "target", { value: paragraph, configurable: true });
      document.dispatchEvent(event);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(result.current.activeThreadId).toBe("t-1");

    await act(async () => {
      result.current.activateThreadFromMark("t-2", 13);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(result.current.activeThreadId).toBe("t-2");
    expect(
      editor.view.dom.querySelector('.comment-mark--active[data-comment-id="t-2"]'),
    ).not.toBeNull();
    unmount();
    editor.destroy();
  });

  it("mark click activates thread without pointerdown clearing active state", () => {
    const ydoc = new Y.Doc();
    const editor = createEditor(
      '<p>Hello <span data-comment-id="t-1" class="comment-mark">world</span> <span data-comment-id="t-2" class="comment-mark">there</span></p>',
    );
    for (const id of ["t-1", "t-2"]) {
      getDocsCommentsMap(ydoc).set(id, {
        id,
        anchorText: id === "t-1" ? "world" : "there",
        createdAt: "2026-01-01T00:00:00.000Z",
        createdBy: { id: "u-1", name: "Alex" },
        resolved: false,
        messages: [
          {
            id: `m-${id}`,
            body: "Note",
            createdAt: "2026-01-01T00:01:00.000Z",
            author: { id: "u-1", name: "Alex" },
          },
        ],
      });
    }

    const { result, unmount } = renderHook(() =>
      useDocsComments({
        ydoc,
        editor,
        currentUser: { id: "u-1", name: "Alex" },
      }),
    );

    act(() => {
      result.current.selectThread("t-1");
    });

    const mark2 = editor.view.dom.querySelector('[data-comment-id="t-2"]');
    expect(mark2).not.toBeNull();

    act(() => {
      mark2!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
      result.current.activateThreadFromMark("t-2", 19);
    });

    expect(result.current.activeThreadId).toBe("t-2");
    expect(
      editor.view.dom.querySelector('.comment-mark--active[data-comment-id="t-2"]'),
    ).not.toBeNull();
    unmount();
    editor.destroy();
  });

  it("restores active mark styling after DOM rebuild on editor update", async () => {
    const ydoc = new Y.Doc();
    const editor = createEditor(
      '<p>Hello <span data-comment-id="t-1" class="comment-mark">world</span></p>',
    );
    getDocsCommentsMap(ydoc).set("t-1", {
      id: "t-1",
      anchorText: "world",
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: { id: "u-1", name: "Alex" },
      resolved: false,
      messages: [
        {
          id: "m-1",
          body: "First",
          createdAt: "2026-01-01T00:01:00.000Z",
          author: { id: "u-1", name: "Alex" },
        },
      ],
    });

    const { result } = renderHook(() =>
      useDocsComments({
        ydoc,
        editor,
        currentUser: { id: "u-1", name: "Alex" },
      }),
    );

    act(() => {
      result.current.selectThread("t-1");
    });

    editor.view.dom.querySelector(".comment-mark")?.classList.remove("comment-mark--active");

    await act(async () => {
      editor.commands.insertContent("!");
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(result.current.activeThreadId).toBe("t-1");
    expect(editor.view.dom.querySelector(".comment-mark--active")).not.toBeNull();
    editor.destroy();
  });

  it("allows multiple users on the same reaction", () => {
    const ydoc = new Y.Doc();
    getDocsCommentsMap(ydoc).set("t-1", {
      id: "t-1",
      anchorText: "world",
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: { id: "u-1", name: "Alex" },
      resolved: false,
      messages: [
        {
          id: "m-1",
          body: "Note",
          createdAt: "2026-01-01T00:01:00.000Z",
          author: { id: "u-1", name: "Alex" },
        },
      ],
      reactions: [{ emoji: "👍", userIds: ["u-1"] }],
    });

    const { result } = renderHook(() =>
      useDocsComments({
        ydoc,
        editor: null,
        currentUser: { id: "u-2", name: "Sam" },
      }),
    );

    act(() => {
      result.current.toggleReaction("t-1", "👍");
    });

    const thread = getDocsCommentsMap(ydoc).get("t-1") as {
      reactions: { emoji: string; userIds: string[] }[];
    };
    expect(thread.reactions).toEqual([{ emoji: "👍", userIds: ["u-1", "u-2"] }]);
  });

  it("does not create a suggestion when adding a comment in suggest mode", () => {
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    const editor = createCollabEditor(ydoc, awareness);

    editor.commands.setSuggestMode();
    editor.commands.setTextSelection({ from: 7, to: 12 });

    const { result: commentsResult } = renderHook(() =>
      useDocsComments({
        ydoc,
        editor,
        currentUser: { id: "u-1", name: "Alex" },
      }),
    );

    const { result: suggestionsResult } = renderHook(() =>
      useDocsSuggestions(editor, {
        ydoc,
        currentUser: { id: "u-1", name: "Alex" },
      }),
    );

    const beforeSuggestionCount = getDocsTrackChangeGroups(editor).length;
    expect(suggestionsResult.current.suggestions).toHaveLength(beforeSuggestionCount);

    act(() => {
      commentsResult.current.createThreadFromSelection();
    });

    act(() => {
      commentsResult.current.submitDraftComment("Looks good");
    });

    expect(commentsResult.current.openThreads).toHaveLength(1);
    expect(commentsResult.current.openThreads[0]?.messages).toHaveLength(1);
    expect(getDocsTrackChangeGroups(editor)).toHaveLength(beforeSuggestionCount);
    expect(suggestionsResult.current.suggestions).toHaveLength(beforeSuggestionCount);
    expect(editor.getHTML()).toContain('data-comment-id="');

    editor.destroy();
  });

  it("blocks comment mutations when canMutateComments is false (view-only)", () => {
    const ydoc = new Y.Doc();
    const map = getDocsCommentsMap(ydoc);
    map.set("t-existing", {
      id: "t-existing",
      anchorText: "Hello",
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: { id: "u-1", name: "Alex" },
      resolved: false,
      messages: [
        {
          id: "m-1",
          body: "Existing",
          createdAt: "2026-01-01T00:01:00.000Z",
          author: { id: "u-1", name: "Alex" },
        },
      ],
    });

    const editor = createEditor();
    editor.commands.setTextSelection({ from: 1, to: 6 });

    const { result } = renderHook(() =>
      useDocsComments({
        ydoc,
        editor,
        currentUser: { id: "u-2", name: "Viewer" },
        commentsVisible: true,
        canMutateComments: false,
      }),
    );

    expect(result.current.canAddComment).toBe(false);
    expect(result.current.selectionQualifiesForComment).toBe(false);

    let threadId: string | null = "sentinel";
    act(() => {
      threadId = result.current.createThreadFromSelection();
    });
    expect(threadId).toBeNull();
    expect(result.current.draftThread).toBeNull();

    act(() => {
      result.current.addReply("t-existing", "should not persist");
      result.current.resolveThread("t-existing");
    });

    expect(map.get("t-existing")).toMatchObject({
      resolved: false,
      messages: [expect.objectContaining({ body: "Existing" })],
    });
    expect(result.current.openThreads).toHaveLength(1);

    editor.destroy();
  });
});
