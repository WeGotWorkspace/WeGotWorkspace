/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommentMark } from "@/text-editor-core/src/text-editor-comment-commands";
import type { DocsCommentThread } from "./docs-comments-types";
import type { DocsFileThread, DocsThreadsClient } from "./docs-threads-types";
import { useDocsComments } from "./use-docs-comments";
import { useDocsCommentsSync } from "./use-docs-comments-sync";

const PATH = "/users/bob/docs/plan.md";
const AUTHOR = { id: "u-1", name: "Alex" };
const MARKED_HTML = '<p>Hello <span data-comment-id="c-1">world</span> and moon</p>';

function createEditor(content = MARKED_HTML) {
  return new Editor({
    extensions: [StarterKit.configure({ undoRedo: false }), CommentMark],
    content,
  });
}

/** Counts every transaction the editor dispatches from now on. */
function watchDispatches(editor: Editor) {
  const dispatch = vi.spyOn(editor.view, "dispatch");
  return () => dispatch.mock.calls.length;
}

/** Counts transactions that change the document (what collab would save). */
function watchDocChanges(editor: Editor) {
  let count = 0;
  editor.on("transaction", ({ transaction }) => {
    if (transaction.docChanged) count += 1;
  });
  return () => count;
}

function thread(id: string, anchorText: string, resolved = false): DocsCommentThread {
  return {
    id,
    anchorText,
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: AUTHOR,
    resolved,
    messages: [
      { id: `${id}-m`, body: "Note", createdAt: "2026-01-01T00:00:00.000Z", author: AUTHOR },
    ],
  };
}

function fileThread(id: string, anchorText: string): DocsFileThread {
  return {
    ...thread(id, anchorText),
    kind: "comment",
    path: PATH,
    changeId: null,
    anchorFrom: null,
    anchorTo: null,
    anchorOccurrence: null,
    archived: false,
    reactions: [],
  };
}

/** A server-backed client (no snapshot), so the list arrives asynchronously. */
function remoteClient(list: DocsThreadsClient["list"]): DocsThreadsClient {
  const unused = () => Promise.reject(new Error("not used in this test"));
  return {
    list,
    create: unused,
    reply: unused,
    react: unused,
    patch: unused,
    changes: unused,
  };
}

afterEach(() => {
  cleanup();
});

describe("useDocsCommentsSync", () => {
  it("leaves the marks alone while the thread list has not loaded", () => {
    const editor = createEditor();
    const dispatches = watchDispatches(editor);

    renderHook(() => useDocsCommentsSync(editor, [], false));
    // An edit fires `update`; the sync must still stay away while unloaded.
    act(() => {
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, "!");
    });

    expect(dispatches()).toBe(1);
    expect(editor.getHTML()).toContain('data-comment-id="c-1"');
    editor.destroy();
  });

  it("syncs once loaded: keeps known marks, drops resolved ones, re-anchors missing ones", () => {
    const editor = createEditor();
    const dispatches = watchDispatches(editor);

    const { rerender } = renderHook(
      ({ threads, loaded }: { threads: DocsCommentThread[]; loaded: boolean }) =>
        useDocsCommentsSync(editor, threads, loaded),
      { initialProps: { threads: [] as DocsCommentThread[], loaded: false } },
    );
    expect(dispatches()).toBe(0);

    // The list matches the document: nothing to write.
    rerender({ threads: [thread("c-1", "world")], loaded: true });
    expect(dispatches()).toBe(0);
    expect(editor.getHTML()).toContain('data-comment-id="c-1"');

    // Resolved on the server, and a new thread whose mark is missing here.
    rerender({ threads: [thread("c-1", "world", true), thread("c-2", "moon")], loaded: true });
    expect(dispatches()).toBe(1);
    expect(editor.getHTML()).not.toContain('data-comment-id="c-1"');
    expect(editor.getHTML()).toContain('data-comment-id="c-2"');
    editor.destroy();
  });
});

describe("useDocsComments mark sync", () => {
  it("writes nothing while the list loads, then nothing when it matches", async () => {
    const editor = createEditor();
    const docChanges = watchDocChanges(editor);
    let resolveList: (threads: DocsFileThread[]) => void = () => undefined;
    const client = remoteClient(
      () =>
        new Promise<DocsFileThread[]>((resolve) => {
          resolveList = resolve;
        }),
    );

    const { result } = renderHook(() =>
      useDocsComments({
        ydoc: null,
        editor,
        currentUser: AUTHOR,
        docPath: PATH,
        threadsClient: client,
      }),
    );
    expect(docChanges()).toBe(0);
    expect(editor.getHTML()).toContain('data-comment-id="c-1"');

    await act(async () => {
      resolveList([fileThread("c-1", "world")]);
    });
    await waitFor(() => expect(result.current.openThreads).toHaveLength(1));
    expect(docChanges()).toBe(0);
    expect(editor.getHTML()).toContain('data-comment-id="c-1"');
    editor.destroy();
  });

  it("keeps every mark when the thread list fails to load", async () => {
    const editor = createEditor();
    const docChanges = watchDocChanges(editor);
    const list = vi.fn(() => Promise.reject(new Error("offline")));
    const client = remoteClient(list);

    const { result } = renderHook(() =>
      useDocsComments({
        ydoc: null,
        editor,
        currentUser: AUTHOR,
        docPath: PATH,
        threadsClient: client,
      }),
    );
    await waitFor(() => expect(list).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });

    // Clicking the highlight must not strip the marks either.
    act(() => {
      result.current.activateThreadFromMark("c-1", 8);
      result.current.selectThread("c-1");
    });

    expect(result.current.threads).toEqual([]);
    expect(docChanges()).toBe(0);
    expect(editor.getHTML()).toContain('data-comment-id="c-1"');
    editor.destroy();
  });
});
