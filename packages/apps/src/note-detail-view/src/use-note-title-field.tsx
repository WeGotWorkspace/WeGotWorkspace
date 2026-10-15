import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type * as Y from "yjs";
import {
  noteTitleIsInDoc,
  readNoteTitle,
  seedNoteTitleOnOpen,
  writeNoteTitle,
} from "@/notes-core/src/note-title-doc";
import { SEED_ORIGIN } from "@/text-editor-core/docs-collab/docs-collab-utils";

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
  /** Create only: seed once from the first heading when SUMMARY was never set. */
  seedTitleFromHeading?: boolean;
  markdown: string;
  readOnly: boolean;
  onTitleChange?: (title: string) => void;
};

/**
 * Bind the title textarea to the note's Y.Text when a collab document is open.
 * Without one, the field stays a controlled input.
 */
export function useNoteTitleField(options: UseNoteTitleFieldOptions): {
  value: string;
  onChange?: (value: string) => void;
} {
  const ydoc = useNoteCollabYDoc();
  const onLocalTitleEdit = useContext(NoteCollabTitleSaveContext);
  const onTitleChangeRef = useRef(options.onTitleChange);
  onTitleChangeRef.current = options.onTitleChange;
  const storedTitleRef = useRef(options.storedTitle);
  storedTitleRef.current = options.storedTitle;
  const seedHeadingRef = useRef(options.seedTitleFromHeading === true);
  seedHeadingRef.current = options.seedTitleFromHeading === true;
  const markdownRef = useRef(options.markdown);
  markdownRef.current = options.markdown;
  const [live, setLive] = useState<string | null>(null);

  useEffect(() => {
    if (!ydoc) {
      setLive(null);
      return;
    }
    const notified = { current: null as string | null };
    seedNoteTitleOnOpen(
      ydoc,
      {
        summary: storedTitleRef.current,
        headingMarkdown: seedHeadingRef.current ? markdownRef.current : undefined,
      },
      SEED_ORIGIN,
    );
    const publish = () => {
      if (!noteTitleIsInDoc(ydoc)) return;
      const next = readNoteTitle(ydoc);
      setLive((current) => (current === next ? current : next));
      if (notified.current === next) return;
      notified.current = next;
      onTitleChangeRef.current?.(next);
    };
    publish();
    ydoc.on("update", publish);
    return () => {
      ydoc.off("update", publish);
    };
  }, [ydoc]);

  const editable = !options.readOnly && (ydoc != null || options.onTitleChange != null);
  const onChange = editable
    ? (value: string) => {
        if (ydoc) {
          writeNoteTitle(ydoc, value);
          onLocalTitleEdit?.();
          return;
        }
        options.onTitleChange?.(value);
      }
    : undefined;

  return { value: live ?? options.title, onChange };
}
