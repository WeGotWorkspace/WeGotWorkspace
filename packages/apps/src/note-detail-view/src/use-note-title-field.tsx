import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type * as Y from "yjs";
import {
  noteTitleIsInDoc,
  readNoteTitle,
  writeNoteTitle,
} from "@/text-editor-core/docs-collab/docs-collab-document-title";

const NoteCollabYDocContext = createContext<Y.Doc | null>(null);
const NoteCollabTitleSaveContext = createContext<(() => void) | null>(null);

/** Y.Doc for the open note. Null outside a collab session. */
export function NoteCollabYDocProvider({
  ydoc,
  onLocalTitleEdit,
  children,
}: {
  ydoc: Y.Doc | null;
  /** Debounced collab save. Title edits do not change the markdown getter. */
  onLocalTitleEdit?: () => void;
  children: ReactNode;
}) {
  return (
    <NoteCollabTitleSaveContext.Provider value={onLocalTitleEdit ?? null}>
      <NoteCollabYDocContext.Provider value={ydoc}>{children}</NoteCollabYDocContext.Provider>
    </NoteCollabTitleSaveContext.Provider>
  );
}

export function useNoteCollabYDoc(): Y.Doc | null {
  return useContext(NoteCollabYDocContext);
}

type UseNoteTitleFieldOptions = {
  title: string;
  /** Stored SUMMARY. Null means never set; "" means the user blanked it. */
  storedTitle?: string | null;
  readOnly: boolean;
  /** Title shown changed, from a user edit or the document. Projection only. */
  onTitleChange?: (title: string) => void;
  /**
   * User edit while no document is open (a `local-*` note, or the document is
   * still loading). Must save the title: nothing else will.
   */
  onTitleEdit?: (title: string) => void;
};

/**
 * Bind the title textarea to the note's Y.Text when a collab document is open.
 * Until that type exists, the field shows the stored SUMMARY and does not write it.
 * Without a document, the field stays a controlled input.
 */
export function useNoteTitleField(options: UseNoteTitleFieldOptions): {
  value: string;
  onChange?: (value: string) => void;
} {
  const ydoc = useNoteCollabYDoc();
  const onLocalTitleEdit = useContext(NoteCollabTitleSaveContext);
  const onTitleChangeRef = useRef(options.onTitleChange);
  onTitleChangeRef.current = options.onTitleChange;
  const fallback = options.storedTitle ?? options.title;

  const subscribe = useCallback(
    (notify: () => void) => {
      if (!ydoc) return () => {};
      const onUpdate = () => {
        notify();
        if (!noteTitleIsInDoc(ydoc)) return;
        onTitleChangeRef.current?.(readNoteTitle(ydoc));
      };
      ydoc.on("update", onUpdate);
      return () => {
        ydoc.off("update", onUpdate);
      };
    },
    [ydoc],
  );
  const getSnapshot = useCallback(
    () => (ydoc ? readNoteTitle(ydoc, fallback) : options.title),
    [fallback, options.title, ydoc],
  );

  const value = useSyncExternalStore(subscribe, getSnapshot, () => options.title);

  const saveWithoutDoc = options.onTitleEdit ?? options.onTitleChange;
  const editable = !options.readOnly && (ydoc != null || saveWithoutDoc != null);
  const onChange = editable
    ? (next: string) => {
        if (ydoc) {
          writeNoteTitle(ydoc, next);
          onLocalTitleEdit?.();
          return;
        }
        saveWithoutDoc?.(next);
      }
    : undefined;

  return { value, onChange };
}
