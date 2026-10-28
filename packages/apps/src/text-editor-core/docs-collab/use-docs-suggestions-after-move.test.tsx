/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { Editor } from "@tiptap/react";
import { Awareness } from "y-protocols/awareness";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import "@/text-editor-core/src/text-editor-track-changes-augmentation";
import { createCollaborativeTextEditorExtensions } from "@/text-editor-core/src/text-editor-extensions";
import { getDocsTrackChangeGroups } from "@/text-editor-core/src/text-editor-track-changes";
import { applyContentSeedToYDoc } from "./docs-collab-editor-surface";
import { suggestionThreadIdForChange } from "./docs-suggestions/docs-suggestion-thread-id";
import type {
  DocsFileThread,
  DocsFileThreadAuthor,
  DocsFileThreadCreate,
  DocsThreadsClient,
} from "./docs-threads-types";
import { DOCS_THREADS_POLL_MS } from "./use-docs-threads-source";
import { useDocsSuggestions } from "./use-docs-suggestions";
import { SUGGESTION_ROOT_SETTLE_MS } from "./use-docs-suggestions-thread-roots";

const PERSONAL = "/users/admin/docs/plan.md";
const GROUP = "/groups/team/plan.md";
const ADMIN = { id: "admin", name: "Admin Example" };
const MEMBER = { id: "member", name: "Member Example" };
const SETTLED = { timeout: SUGGESTION_ROOT_SETTLE_MS + 1_500 };

const editors: Editor[] = [];

beforeEach(() => {
  document.elementFromPoint = () => null;
  document.elementsFromPoint = () => [];
});

afterEach(() => {
  cleanup();
  for (const editor of editors.splice(0)) editor.destroy();
});

/**
 * Threads keyed by document path, like the API: a move keeps each thread's id
 * and points it at the new path. A create is idempotent per id only, so a
 * second id for the same change makes a second root, which the client must
 * never ask for.
 */
function createThreadsServer() {
  let threads: DocsFileThread[] = [];
  const creates: { path: string; input: DocsFileThreadCreate }[] = [];
  let listGate: Promise<void> = Promise.resolve();

  const copy = (thread: DocsFileThread): DocsFileThread => structuredClone(thread);
  const find = (path: string, id: string) => {
    const thread = threads.find((item) => item.id === id && item.path === path);
    if (!thread) throw new Error(`no thread ${id} on ${path}`);
    return thread;
  };

  function clientFor(actor: DocsFileThreadAuthor): DocsThreadsClient {
    return {
      async list(path) {
        await listGate;
        return threads.filter((thread) => thread.path === path).map(copy);
      },
      async create(path, input) {
        creates.push({ path, input });
        const existing = threads.find((thread) => thread.id === input.id);
        if (existing) return copy(existing);
        const now = new Date().toISOString();
        const thread: DocsFileThread = {
          id: input.id,
          kind: input.kind,
          path,
          changeId: input.changeId ?? null,
          anchorText: input.anchorText ?? "",
          anchorFrom: input.anchorFrom ?? null,
          anchorTo: input.anchorTo ?? null,
          anchorOccurrence: null,
          createdAt: now,
          createdBy: { ...actor },
          resolved: false,
          archived: false,
          messages: [{ id: input.id, body: input.body, createdAt: now, author: { ...actor } }],
          reactions: [],
        };
        threads.push(thread);
        return copy(thread);
      },
      async reply(path, threadId, input) {
        const thread = find(path, threadId);
        const createdAt = new Date().toISOString();
        thread.messages.push({ id: input.id, body: input.body, createdAt, author: { ...actor } });
        return copy(thread);
      },
      async react(path, threadId) {
        return copy(find(path, threadId));
      },
      async patch(path, threadId, patch) {
        const thread = find(path, threadId);
        if (patch.archived !== undefined) thread.archived = patch.archived;
        return copy(thread);
      },
      async changes() {
        return {
          oldState: "0",
          newState: "0",
          created: [],
          updated: [],
          destroyed: [],
          hasMoreChanges: false,
        };
      },
    };
  }

  return {
    clientFor,
    creates,
    move(from: string, to: string) {
      threads = threads.map((thread) => (thread.path === from ? { ...thread, path: to } : thread));
    },
    /** Hold every list until the returned release runs. */
    holdLists() {
      let release = () => {};
      listGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    roots(changeId: string) {
      return threads.filter(
        (thread) => thread.kind === "suggestion" && thread.changeId === changeId,
      );
    },
  };
}

function createEditor(ydoc: Y.Doc, trackChangesUserKey: string) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: createCollaborativeTextEditorExtensions({
      document: ydoc,
      awareness: new Awareness(ydoc),
      trackChangesUserKey,
      user: { name: "Browser tab", color: "#db2777" },
      format: "markdown",
    }),
  });
  editors.push(editor);
  return editor;
}

function suggestReplace(editor: Editor, from: number, to: number, text: string) {
  act(() => {
    editor.commands.setSuggestMode();
    editor.commands.setTextSelection({ from, to });
    const view = editor.view;
    view.someProp("handleTextInput", (handler) =>
      (handler as (v: typeof view, f: number, t: number, s: string) => boolean)(
        view,
        from,
        to,
        text,
      ),
    );
  });
}

function openDoc(
  editor: Editor,
  server: ReturnType<typeof createThreadsServer>,
  actor: DocsFileThreadAuthor,
  docPath: string,
) {
  const options = {
    ydoc: null,
    currentUser: actor,
    threadsClient: server.clientFor(actor),
    docPath,
  };
  return renderHook(() => useDocsSuggestions(editor, options));
}

/**
 * Admin suggests in a personal folder, then the file moves into a group
 * folder: the thread root moves along and keeps the id derived from the
 * personal path.
 */
async function suggestThenMove() {
  const server = createThreadsServer();
  const ydoc = new Y.Doc();
  applyContentSeedToYDoc(ydoc, "Hello old world", "markdown");
  // The same track-changes id after the move, so admin's editor claims the old mark.
  const adminKey = crypto.randomUUID();

  const before = createEditor(ydoc, adminKey);
  const personal = openDoc(before, server, ADMIN, PERSONAL);
  suggestReplace(before, 7, 10, "new");
  const oldChange = getDocsTrackChangeGroups(before)[0]!.changeId;
  await waitFor(() => expect(server.roots(oldChange)).toHaveLength(1), SETTLED);
  personal.unmount();

  server.move(PERSONAL, GROUP);
  const movedRootId = suggestionThreadIdForChange(PERSONAL, oldChange);
  expect(server.roots(oldChange)).toMatchObject([{ id: movedRootId, path: GROUP }]);
  expect(movedRootId).not.toBe(suggestionThreadIdForChange(GROUP, oldChange));

  return { server, ydoc, adminKey, oldChange, movedRootId };
}

describe("suggestion thread roots after the document moves", () => {
  it("shows the author to a member and keeps one root per change when admin suggests again", async () => {
    const { server, ydoc, adminKey, oldChange, movedRootId } = await suggestThenMove();

    const member = openDoc(createEditor(ydoc, crypto.randomUUID()), server, MEMBER, GROUP);
    await waitFor(() =>
      expect(member.result.current.suggestions).toMatchObject([
        { changeId: oldChange, authorName: ADMIN.name },
      ]),
    );

    // Admin reopens at the new path; the thread list is slow to arrive.
    const release = server.holdLists();
    const after = createEditor(ydoc, adminKey);
    const admin = openDoc(after, server, ADMIN, GROUP);
    suggestReplace(after, 1, 6, "Hi");
    const newChange = getDocsTrackChangeGroups(after).find(
      (item) => item.changeId !== oldChange,
    )!.changeId;
    await act(() => new Promise((resolve) => setTimeout(resolve, SUGGESTION_ROOT_SETTLE_MS + 300)));
    expect(server.creates.filter(({ path }) => path === GROUP)).toEqual([]);

    release();
    await waitFor(() => expect(server.roots(newChange)).toHaveLength(1), SETTLED);
    expect(server.roots(oldChange)).toMatchObject([{ id: movedRootId }]);
    expect(server.creates.filter(({ input }) => input.changeId === oldChange)).toHaveLength(1);
    await waitFor(() =>
      expect(admin.result.current.suggestions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ changeId: oldChange, authorName: ADMIN.name }),
          expect.objectContaining({ changeId: newChange, authorName: ADMIN.name }),
        ]),
      ),
    );
    await waitFor(() =>
      expect(member.result.current.suggestions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ changeId: oldChange, authorName: ADMIN.name }),
        ]),
      ),
    );
  });

  it("replies on the moved root when the list has not loaded yet", async () => {
    const { server, ydoc, oldChange, movedRootId } = await suggestThenMove();

    const release = server.holdLists();
    const member = openDoc(createEditor(ydoc, crypto.randomUUID()), server, MEMBER, GROUP);
    await act(async () => {
      // addReply is typed void for the cards; the hook returns its promise.
      const replied = member.result.current.addReply(oldChange, "Looks good") as unknown;
      release();
      await replied;
    });

    expect(server.creates.filter(({ path }) => path === GROUP)).toEqual([]);
    const [root] = server.roots(oldChange);
    expect(root).toMatchObject({ id: movedRootId, createdBy: ADMIN });
    expect(root!.messages.map((message) => message.body)).toContain("Looks good");
  });

  it("retries a failed first thread list from the poll and then records the root", async () => {
    const server = createThreadsServer();
    const ydoc = new Y.Doc();
    applyContentSeedToYDoc(ydoc, "Hello old world", "markdown");
    const editor = createEditor(ydoc, crypto.randomUUID());
    const client = server.clientFor(ADMIN);
    const list = client.list.bind(client);
    let failures = 1;
    client.list = async (path) => {
      if (failures-- > 0) throw new Error("offline");
      return list(path);
    };
    renderHook(() =>
      useDocsSuggestions(editor, {
        ydoc: null,
        currentUser: ADMIN,
        threadsClient: client,
        docPath: PERSONAL,
        pollThreads: true,
      }),
    );
    suggestReplace(editor, 7, 10, "new");
    const change = getDocsTrackChangeGroups(editor)[0]!.changeId;
    await waitFor(() => expect(server.roots(change)).toHaveLength(1), {
      timeout: DOCS_THREADS_POLL_MS + SUGGESTION_ROOT_SETTLE_MS + 3_000,
    });
    expect(server.creates.filter(({ input }) => input.changeId === change)).toHaveLength(1);
  }, 20_000);
});
