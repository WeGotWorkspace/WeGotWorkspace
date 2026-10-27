/** @vitest-environment jsdom */
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { Editor } from "@tiptap/react";
import { Awareness } from "y-protocols/awareness";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { docsLabels } from "@/docs-core/src/docs-labels";
import "@/text-editor-core/src/text-editor-track-changes-augmentation";
import { setTextEditorContent } from "@/text-editor-core/src/text-editor-content";
import { createCollaborativeTextEditorExtensions } from "@/text-editor-core/src/text-editor-extensions";
import { getDocsTrackChangeGroups } from "@/text-editor-core/src/text-editor-track-changes";
import { TooltipProvider } from "@/ui/tooltip";
import { avatarColorForUserId } from "@/user-avatar/src/user-avatar-color";
import { applyContentSeedToYDoc } from "./docs-collab-editor-surface";
import { DocsSuggestionCard } from "./docs-suggestions/docs-suggestion-card";
import { suggestionThreadIdForChange } from "./docs-suggestions/docs-suggestion-thread-id";
import { createDocsThreadsMemory } from "./docs-threads-memory";
import {
  DOCS_THREADS_TEST_PATH,
  useTestDocsSuggestions as useDocsSuggestions,
} from "./docs-threads-test-client";
import { SUGGESTION_ROOT_SETTLE_MS } from "./use-docs-suggestions-thread-roots";

const ALEX = { id: "alex", name: "Alex Example" };
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

function createEditor(ydoc: Y.Doc, seed: string | null = "Hello old world") {
  if (seed != null) applyContentSeedToYDoc(ydoc, seed, "markdown");
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: createCollaborativeTextEditorExtensions({
      document: ydoc,
      awareness: new Awareness(ydoc),
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

function suggestionRoots(client: ReturnType<typeof createDocsThreadsMemory>, changeId: string) {
  return client
    .snapshot()
    .filter((thread) => thread.kind === "suggestion" && thread.changeId === changeId);
}

describe("suggestion thread roots", () => {
  it("creates the thread root when the suggestion is made, once per change id", async () => {
    const editor = createEditor(new Y.Doc());
    const client = createDocsThreadsMemory(DOCS_THREADS_TEST_PATH, ALEX);
    const options = { ydoc: null, currentUser: ALEX, threadsClient: client };
    const { result } = renderHook(() => useDocsSuggestions(editor, options));
    // A second tab of the same session on the same document.
    renderHook(() => useDocsSuggestions(editor, options));

    suggestReplace(editor, 7, 10, "new");
    const changeId = getDocsTrackChangeGroups(editor)[0]!.changeId;

    await waitFor(() => expect(suggestionRoots(client, changeId)).toHaveLength(1), SETTLED);
    const [root] = suggestionRoots(client, changeId);
    expect(root).toMatchObject({
      id: suggestionThreadIdForChange(DOCS_THREADS_TEST_PATH, changeId),
      createdBy: ALEX,
      archived: false,
    });
    expect(root!.createdAt).toBeTruthy();

    await waitFor(() => {
      const suggestion = result.current.suggestions.find((item) => item.changeId === changeId);
      expect(suggestion).toMatchObject({
        authorId: ALEX.id,
        authorName: ALEX.name,
        authorColor: avatarColorForUserId(ALEX.id),
        timestamp: root!.createdAt,
      });
    });

    await act(async () => {
      await result.current.addReply(changeId, "Looks good");
    });
    expect(suggestionRoots(client, changeId)).toHaveLength(1);
    expect(suggestionRoots(client, changeId)[0]!.messages.at(-1)?.body).toBe("Looks good");
  });

  it("leaves a peer's suggestion to that peer", async () => {
    const ydoc = new Y.Doc();
    const mine = createEditor(ydoc);
    const peer = createEditor(ydoc, null);
    const client = createDocsThreadsMemory(DOCS_THREADS_TEST_PATH, ALEX);
    const { result } = renderHook(() =>
      useDocsSuggestions(mine, { ydoc: null, currentUser: ALEX, threadsClient: client }),
    );

    suggestReplace(peer, 7, 10, "new");
    await waitFor(() => expect(result.current.suggestions).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, SUGGESTION_ROOT_SETTLE_MS + 200));

    expect(client.snapshot()).toHaveLength(0);
    expect(result.current.suggestions[0]).toMatchObject({ authorId: "", authorName: "" });
  });

  it("keeps the author of a live suggestion whose journal was archived", async () => {
    const ydoc = new Y.Doc();
    const peer = createEditor(ydoc);
    suggestReplace(peer, 7, 10, "new");
    const changeId = getDocsTrackChangeGroups(peer)[0]!.changeId;
    const client = createDocsThreadsMemory(DOCS_THREADS_TEST_PATH, ALEX);
    const root = await client.create(DOCS_THREADS_TEST_PATH, {
      id: suggestionThreadIdForChange(DOCS_THREADS_TEST_PATH, changeId),
      kind: "suggestion",
      changeId,
      body: "",
    });
    await client.patch(DOCS_THREADS_TEST_PATH, root.id, { archived: true, changeId });

    const mine = createEditor(ydoc, null);
    const { result } = renderHook(() =>
      useDocsSuggestions(mine, {
        ydoc: null,
        currentUser: { id: "sam", name: "Sam Lee" },
        threadsClient: client,
      }),
    );

    await waitFor(() =>
      expect(result.current.suggestions[0]).toMatchObject({
        changeId,
        authorName: ALEX.name,
        timestamp: root.createdAt,
      }),
    );
  });

  it("reopens an archived journal when a live suggestion gets a reply", async () => {
    const ydoc = new Y.Doc();
    const peer = createEditor(ydoc);
    suggestReplace(peer, 7, 10, "new");
    const changeId = getDocsTrackChangeGroups(peer)[0]!.changeId;
    const client = createDocsThreadsMemory(DOCS_THREADS_TEST_PATH, ALEX);
    const root = await client.create(DOCS_THREADS_TEST_PATH, {
      id: suggestionThreadIdForChange(DOCS_THREADS_TEST_PATH, changeId),
      kind: "suggestion",
      changeId,
      body: "",
    });
    await client.patch(DOCS_THREADS_TEST_PATH, root.id, { archived: true, changeId });

    const mine = createEditor(ydoc, null);
    const { result } = renderHook(() =>
      useDocsSuggestions(mine, { ydoc: null, currentUser: ALEX, threadsClient: client }),
    );
    await waitFor(() => expect(result.current.suggestions).toHaveLength(1));

    await act(async () => {
      await result.current.addReply(changeId, "Back again");
    });

    expect(suggestionRoots(client, changeId)).toHaveLength(1);
    expect(suggestionRoots(client, changeId)[0]).toMatchObject({ archived: false });
    await waitFor(() =>
      expect(result.current.suggestions[0]!.messages.at(-1)?.body).toBe("Back again"),
    );
  });

  it("shows an older suggestion without a thread as Unknown author, and still accepts it", async () => {
    const editor = createEditor(new Y.Doc(), null);
    act(() => {
      setTextEditorContent(
        editor,
        'Hello <del data-change-id="ch_1_1_old" data-author-name="Alex Chrome">old</del>' +
          '<ins data-change-id="ch_1_1_old" data-author-name="Alex Chrome">new</ins> world',
        "markdown",
      );
    });
    const client = createDocsThreadsMemory(DOCS_THREADS_TEST_PATH, ALEX);
    const { result } = renderHook(() =>
      useDocsSuggestions(editor, { ydoc: null, currentUser: ALEX, threadsClient: client }),
    );

    await waitFor(() => expect(result.current.suggestions).toHaveLength(1));
    const suggestion = result.current.suggestions[0]!;
    expect(suggestion).toMatchObject({ changeId: "ch_1_1_old", authorName: "" });
    expect(client.snapshot()).toHaveLength(0);

    const noop = () => {};
    render(
      <TooltipProvider>
        <DocsSuggestionCard
          suggestion={suggestion}
          labels={docsLabels}
          currentUserId={ALEX.id}
          active={false}
          onSelect={noop}
          onAccept={noop}
          onReject={noop}
          onAddReply={noop}
          onToggleReaction={noop}
        />
      </TooltipProvider>,
    );
    expect(screen.getByText(docsLabels.suggestionsUnknownAuthor)).toBeTruthy();
    expect(screen.queryByText("Alex Chrome")).toBeNull();

    act(() => {
      result.current.acceptSuggestion("ch_1_1_old");
    });
    expect(editor.getText()).toBe("Hello new world");
    await waitFor(() => expect(suggestionRoots(client, "ch_1_1_old")[0]?.archived).toBe(true));
  });
});
