import { act, fireEvent, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import * as awarenessProtocol from "y-protocols/awareness";
import * as Y from "yjs";
import { writeNoteTitle } from "@/text-editor-core/docs-collab/docs-collab-document-title";
import {
  NOTE_TITLE_SELECTION_FIELD,
  decodeTitleSelection,
  encodeTitleSelection,
} from "@/text-editor-core/docs-collab/docs-collab-title-selection";
import { useNoteTitleCarets } from "@/note-detail-view/src/use-note-title-carets";
import { NoteCollabYDocProvider } from "@/note-detail-view/src/use-note-title-field";

type Peer = { doc: Y.Doc; awareness: awarenessProtocol.Awareness };

function peer(name: string, title?: string): Peer {
  const doc = new Y.Doc();
  if (title !== undefined) writeNoteTitle(doc, title);
  const awareness = new awarenessProtocol.Awareness(doc);
  awareness.setLocalStateField("user", { name, color: "#dc2626" });
  return { doc, awareness };
}

function syncDocs(from: Y.Doc, to: Y.Doc): void {
  Y.applyUpdate(to, Y.encodeStateAsUpdate(from));
}

/** Delivers `from`'s awareness state to `to`, as the mesh would. */
function relayAwareness(from: Peer, to: Peer): void {
  const update = awarenessProtocol.encodeAwarenessUpdate(from.awareness, [from.awareness.clientID]);
  awarenessProtocol.applyAwarenessUpdate(to.awareness, update, "mesh");
}

function setRemoteCaret(remote: Peer, index: number | null): void {
  remote.awareness.setLocalStateField(
    NOTE_TITLE_SELECTION_FIELD,
    index === null ? null : encodeTitleSelection(remote.doc, { anchor: index, head: index }),
  );
}

const textareas: HTMLTextAreaElement[] = [];

function titleTextarea(value: string): { current: HTMLTextAreaElement } {
  const element = document.createElement("textarea");
  element.value = value;
  document.body.append(element);
  textareas.push(element);
  return { current: element };
}

function renderCarets(local: Peer, options: { publish?: boolean; title?: string } = {}) {
  const ref = titleTextarea(options.title ?? "Hello world");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NoteCollabYDocProvider ydoc={local.doc} awareness={local.awareness} localUserName="Ada">
      {children}
    </NoteCollabYDocProvider>
  );
  const hook = renderHook(() => useNoteTitleCarets(ref, { publish: options.publish ?? true }), {
    wrapper,
  });
  return { ...hook, textarea: ref.current };
}

function publishedSelection(local: Peer) {
  const state = local.awareness.getLocalState()?.[NOTE_TITLE_SELECTION_FIELD];
  return state == null ? null : decodeTitleSelection(local.doc, state);
}

afterEach(() => {
  for (const element of textareas.splice(0)) element.remove();
});

describe("useNoteTitleCarets", () => {
  it("publishes the title selection while the title has focus", () => {
    const local = peer("Ada", "Hello world");
    const { textarea } = renderCarets(local);

    act(() => {
      textarea.focus();
      textarea.setSelectionRange(2, 5);
      fireEvent.select(textarea);
    });

    expect(publishedSelection(local)).toEqual({ anchor: 2, head: 5 });
  });

  it("puts the caret at the start of a selection made backwards", () => {
    const local = peer("Ada", "Hello world");
    const { textarea } = renderCarets(local);

    act(() => {
      textarea.focus();
      textarea.setSelectionRange(2, 5, "backward");
      fireEvent.select(textarea);
    });

    expect(publishedSelection(local)).toEqual({ anchor: 5, head: 2 });
  });

  // Chrome and Safari on macOS report `none` for a mouse selection in either
  // direction. The end the selection grew from is the anchor.
  it("puts the caret at the start of a right-to-left drag the browser reports without a direction", () => {
    const local = peer("Ada", "Hello world");
    const { textarea } = renderCarets(local);

    act(() => {
      textarea.focus();
      textarea.setSelectionRange(8, 8);
      fireEvent.select(textarea);
    });
    act(() => {
      textarea.setSelectionRange(5, 8, "none");
      fireEvent.select(textarea);
    });
    act(() => {
      textarea.setSelectionRange(3, 8, "none");
      fireEvent.select(textarea);
    });

    expect(publishedSelection(local)).toEqual({ anchor: 8, head: 3 });
  });

  it("puts the caret at the end of a left-to-right drag the browser reports without a direction", () => {
    const local = peer("Ada", "Hello world");
    const { textarea } = renderCarets(local);

    act(() => {
      textarea.focus();
      textarea.setSelectionRange(3, 3);
      fireEvent.select(textarea);
    });
    act(() => {
      textarea.setSelectionRange(3, 8, "none");
      fireEvent.select(textarea);
    });

    expect(publishedSelection(local)).toEqual({ anchor: 3, head: 8 });
  });

  it("publishes the caret once the first letter creates the document title", () => {
    const local = peer("Ada");
    const { textarea } = renderCarets(local, { title: "" });
    act(() => textarea.focus());
    expect(publishedSelection(local)).toBeNull();

    act(() => {
      textarea.value = "H";
      textarea.setSelectionRange(1, 1);
      writeNoteTitle(local.doc, "H");
    });

    expect(publishedSelection(local)).toEqual({ anchor: 1, head: 1 });
  });

  it("clears the published caret when focus leaves the title", () => {
    const local = peer("Ada", "Hello world");
    const { textarea } = renderCarets(local);
    act(() => {
      textarea.focus();
      textarea.setSelectionRange(3, 3);
      fireEvent.keyUp(textarea);
    });

    act(() => textarea.blur());

    expect(local.awareness.getLocalState()?.[NOTE_TITLE_SELECTION_FIELD]).toBeNull();
  });

  it("clears the published caret when the title unmounts", () => {
    const local = peer("Ada", "Hello world");
    const { textarea, unmount } = renderCarets(local);
    act(() => {
      textarea.focus();
      fireEvent.select(textarea);
    });

    unmount();

    expect(local.awareness.getLocalState()?.[NOTE_TITLE_SELECTION_FIELD]).toBeNull();
  });

  it("does not publish a caret from a read-only title", () => {
    const local = peer("Ada", "Hello world");
    const { textarea } = renderCarets(local, { publish: false });

    act(() => {
      textarea.focus();
      fireEvent.select(textarea);
    });

    expect(local.awareness.getLocalState()?.[NOTE_TITLE_SELECTION_FIELD]).toBeUndefined();
  });

  it("returns another participant's caret, and drops it when they leave the title", () => {
    const local = peer("Ada", "Hello world");
    const remote = peer("Grace");
    syncDocs(local.doc, remote.doc);
    const { result } = renderCarets(local);

    act(() => {
      setRemoteCaret(remote, 6);
      relayAwareness(remote, local);
    });
    expect(result.current).toEqual([
      { clientId: remote.awareness.clientID, name: "Grace", color: "#dc2626", anchor: 6, head: 6 },
    ]);

    act(() => {
      setRemoteCaret(remote, null);
      relayAwareness(remote, local);
    });
    expect(result.current).toEqual([]);
  });

  it("drops the caret when the participant leaves the note", () => {
    const local = peer("Ada", "Hello world");
    const remote = peer("Grace");
    syncDocs(local.doc, remote.doc);
    const { result } = renderCarets(local);
    act(() => {
      setRemoteCaret(remote, 6);
      relayAwareness(remote, local);
    });

    act(() => {
      awarenessProtocol.removeAwarenessStates(local.awareness, [remote.awareness.clientID], "mesh");
    });

    expect(result.current).toEqual([]);
  });

  it("moves a remote caret when text lands before it", () => {
    const local = peer("Ada", "Hello world");
    const remote = peer("Grace");
    syncDocs(local.doc, remote.doc);
    const { result } = renderCarets(local);
    act(() => {
      setRemoteCaret(remote, 6);
      relayAwareness(remote, local);
    });

    act(() => writeNoteTitle(local.doc, "Oh Hello world"));

    expect(result.current[0]?.head).toBe(9);
  });

  it("shows no caret for the local account's other tabs", () => {
    const local = peer("Ada", "Hello world");
    const otherTab = peer("Ada");
    syncDocs(local.doc, otherTab.doc);
    const { result } = renderCarets(local);

    act(() => {
      setRemoteCaret(otherTab, 2);
      relayAwareness(otherTab, local);
    });

    expect(result.current).toEqual([]);
  });
});
