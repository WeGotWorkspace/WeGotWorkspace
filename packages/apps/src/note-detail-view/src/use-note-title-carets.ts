import { useEffect, useState, type RefObject } from "react";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";
import {
  NOTE_TITLE_SELECTION_FIELD,
  encodeTitleSelection,
  listRemoteTitleCarets,
  type RemoteTitleCaret,
} from "@/text-editor-core/docs-collab/docs-collab-title-selection";
import {
  useNoteCollabPresence,
  useNoteCollabYDoc,
  type NoteCollabPresence,
} from "@/note-detail-view/src/use-note-title-field";

/** Events after which the textarea selection may have moved. */
const SELECTION_EVENTS = ["focus", "select", "input", "keyup", "pointerup", "selectionchange"];

/**
 * Title carets for the open note. Publishes this tab's title selection while
 * the title has focus (`publish`), and returns the other participants' carets.
 */
export function useNoteTitleCarets(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  { publish }: { publish: boolean },
): RemoteTitleCaret[] {
  const ydoc = useNoteCollabYDoc();
  const presence = useNoteCollabPresence();
  usePublishTitleSelection(textareaRef, ydoc, publish ? (presence?.awareness ?? null) : null);
  return useRemoteTitleCarets(ydoc, presence);
}

function usePublishTitleSelection(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  ydoc: Y.Doc | null,
  awareness: Awareness | null,
): void {
  useEffect(() => {
    const element = textareaRef.current;
    if (!element || !ydoc || !awareness) return;
    let last: string | undefined;
    const set = (state: ReturnType<typeof encodeTitleSelection>) => {
      const serialized = JSON.stringify(state);
      if (serialized === last) return;
      last = serialized;
      awareness.setLocalStateField(NOTE_TITLE_SELECTION_FIELD, state);
    };
    const publishSelection = () => {
      if (element.ownerDocument.activeElement !== element) return;
      const forward = element.selectionDirection !== "backward";
      const [anchor, head] = forward
        ? [element.selectionStart, element.selectionEnd]
        : [element.selectionEnd, element.selectionStart];
      set(encodeTitleSelection(ydoc, { anchor, head }));
    };
    const clear = () => set(null);
    // The first typed letter creates the title type after the input event.
    // A remote update is skipped: the textarea value has not caught up yet.
    const onDocUpdate = (_update: Uint8Array, _origin: unknown, _doc: Y.Doc, tr: Y.Transaction) => {
      if (tr.local) publishSelection();
    };

    for (const type of SELECTION_EVENTS) element.addEventListener(type, publishSelection);
    element.addEventListener("blur", clear);
    // Chrome fires `selectionchange` for text fields on the document only.
    element.ownerDocument.addEventListener("selectionchange", publishSelection);
    ydoc.on("update", onDocUpdate);
    publishSelection();
    return () => {
      for (const type of SELECTION_EVENTS) element.removeEventListener(type, publishSelection);
      element.removeEventListener("blur", clear);
      element.ownerDocument.removeEventListener("selectionchange", publishSelection);
      ydoc.off("update", onDocUpdate);
      if (last !== undefined) clear();
    };
  }, [textareaRef, ydoc, awareness]);
}

function useRemoteTitleCarets(
  ydoc: Y.Doc | null,
  presence: NoteCollabPresence | null,
): RemoteTitleCaret[] {
  const [carets, setCarets] = useState<RemoteTitleCaret[]>([]);

  useEffect(() => {
    if (!ydoc || !presence) {
      setCarets([]);
      return;
    }
    const { awareness, localUserName } = presence;
    let last = "";
    const refresh = () => {
      const next = listRemoteTitleCarets(ydoc, awareness.getStates(), {
        clientId: awareness.clientID,
        userName: localUserName,
      });
      const serialized = JSON.stringify(next);
      if (serialized === last) return;
      last = serialized;
      setCarets(next);
    };
    refresh();
    awareness.on("change", refresh);
    ydoc.on("update", refresh);
    return () => {
      awareness.off("change", refresh);
      ydoc.off("update", refresh);
    };
  }, [ydoc, presence]);

  return carets;
}
