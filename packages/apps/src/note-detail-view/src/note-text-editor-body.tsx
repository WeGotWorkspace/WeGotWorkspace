import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Editor, UseEditorOptions } from "@tiptap/react";
import { cn } from "@/lib/utils";
import { getAcceptedTextEditorContent } from "@/text-editor-core/src/text-editor-track-changes";
import { TextEditorSheet } from "@/text-editor-core/src/text-editor-sheet";
import { useTextEditor } from "@/text-editor-core/src/use-text-editor";
import {
  DocsCollabEditor,
  DocsCollabPresenceChrome,
  mergeCollabPresencePeers,
  useDocsCollab,
  useDocsCollabAwarenessPresence,
} from "@/text-editor-core/docs-collab";
import type { DocsCollabUrls } from "@/text-editor-core/docs-collab";
import type { DocsCollabWireOperations } from "@/text-editor-core/docs-collab/docs-collab-wire";
import { replaceDocumentWithExternalText } from "@/text-editor-core/docs-collab/docs-collab-external-write";
import { NotesExternalWriteDialog } from "@/notes-core/src/notes-external-write-dialog";
import { defaultNotesLabels, type NotesUILabels } from "@/notes-core/src/notes-labels";

import { NoteCollabYDocProvider } from "@/note-detail-view/src/use-note-title-field";
import "@/text-editor-core/src/text-editor.css";
import "@/note-detail-view/src/note-text-editor-body.css";

/** Debounce Yjs hydrate/remote bursts before pushing list preview. */
const BODY_PREVIEW_SYNC_DEBOUNCE_MS = 50;

/**
 * Configures the body as a live + offline Yjs collab document (Docs #230 stack).
 * Room = VJOURNAL UID (Decision 7), not a Drive path.
 */
export type NoteCollabConfig = {
  userName: string;
  urls: DocsCollabUrls;
  wire?: DocsCollabWireOperations;
};

export type NoteTextEditorBodyProps = {
  /** Remount editor when the active note changes. */
  noteId: string;
  /** Remount the read-only/solo editor when remote content revision changes. */
  contentRevision?: string;
  initialMarkdown: string;
  readOnly?: boolean;
  /**
   * When provided and not read-only, the body is edited collaboratively via the
   * Docs Yjs stack (offline cache, deferred REST save, live mesh). Body changes
   * persist through the collab document — never through the Notes metadata API.
   */
  collab?: NoteCollabConfig;
  className?: string;
};

type NoteCollabContextValue = ReturnType<typeof useDocsCollab> & {
  localDisplayName: string;
};

const NoteCollabContext = createContext<NoteCollabContextValue | null>(null);

function useNoteCollabContext(): NoteCollabContextValue {
  const value = useContext(NoteCollabContext);
  if (!value) {
    throw new Error("NoteCollabChrome and NoteCollabEditorSurface require NoteCollabSession.");
  }
  return value;
}

export type NoteCollabSessionProps = {
  userName: string;
  urls: DocsCollabUrls;
  wire?: DocsCollabWireOperations;
  initialMarkdown: string;
  localDisplayName: string;
  /** Shown when an outside writer changed the note. */
  documentTitle?: string;
  /**
   * Fired when accepted body markdown changes so Notes can refresh list preview +
   * “Edited” time without routing body bytes through the metadata API.
   *
   * TipTap’s collab `onUpdate` skips Yjs-origin transactions (`isChangeOrigin`),
   * so callers must also invoke this on editor bind / remote document updates —
   * otherwise previews stay “Untitled note” until the first keystroke.
   *
   * `source: "hydrate"` fills body/excerpt without bumping display date;
   * `"local-edit"` (default) bumps “Last edited” for real typing.
   */
  onBodyMarkdownChange?: (markdown: string, source?: "local-edit" | "hydrate") => void;
  children: ReactNode;
};

/** Single Yjs collab session for a note body; wraps detail chrome + editor. */
export function NoteCollabSession({
  userName,
  urls,
  wire,
  initialMarkdown,
  localDisplayName,
  documentTitle = defaultNotesLabels.titlePlaceholder,
  onBodyMarkdownChange,
  children,
}: NoteCollabSessionProps) {
  const [externalPrompt, setExternalPrompt] = useState<{
    markdown: string;
    title: string | null;
  } | null>(null);
  const [externalBusy, setExternalBusy] = useState(false);
  const onExternalWrite = useCallback((detail: { markdown: string; title: string | null }) => {
    setExternalPrompt(detail);
  }, []);
  const collabUrls = useMemo(() => ({ ...urls, onExternalWrite }), [onExternalWrite, urls]);
  const collab = useDocsCollab({
    userName,
    autoJoin: true,
    urls: collabUrls,
    wire,
    seedContent: initialMarkdown,
  });
  const getMarkdownRef = useRef<(() => string) | null>(null);
  const onBodyMarkdownChangeRef = useRef(onBodyMarkdownChange);
  onBodyMarkdownChangeRef.current = onBodyMarkdownChange;
  const lastNotifiedMarkdownRef = useRef<string | null>(null);

  const syncBodyPreview = useCallback((source: "local-edit" | "hydrate") => {
    const getMarkdown = getMarkdownRef.current;
    const notify = onBodyMarkdownChangeRef.current;
    if (!getMarkdown || !notify) return;
    const markdown = getMarkdown();
    // TipTap/Yjs can emit many updates for the same document; skip duplicates so
    // list setState does not loop (Maximum update depth exceeded).
    if (lastNotifiedMarkdownRef.current === markdown) return;
    lastNotifiedMarkdownRef.current = markdown;
    notify(markdown, source);
  }, []);

  const onMarkdownChange = useCallback(
    (getMarkdown: () => string) => {
      getMarkdownRef.current = getMarkdown;
      collab.onMarkdownChange(getMarkdown);
      const markdown = getMarkdown();
      if (lastNotifiedMarkdownRef.current === markdown) return;
      lastNotifiedMarkdownRef.current = markdown;
      onBodyMarkdownChangeRef.current?.(markdown, "local-edit");
    },
    [collab.onMarkdownChange],
  );

  const registerMarkdownGetter = useCallback(
    (getMarkdown: () => string) => {
      getMarkdownRef.current = getMarkdown;
      collab.registerMarkdownGetter(getMarkdown);
      // Editor just bound to the loaded Yjs doc — push preview without waiting
      // for a local keystroke (Yjs-origin updates are filtered in TipTap).
      syncBodyPreview("hydrate");
    },
    [collab.registerMarkdownGetter, syncBodyPreview],
  );

  useEffect(() => {
    // New collab session → allow one hydrate notify for the freshly loaded doc.
    lastNotifiedMarkdownRef.current = null;
  }, [collab.session?.ydoc]);

  useEffect(() => {
    const ydoc = collab.session?.ydoc;
    if (!ydoc) return;
    let timer: number | undefined;
    const onUpdate = () => {
      if (!onBodyMarkdownChangeRef.current) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => syncBodyPreview("hydrate"), BODY_PREVIEW_SYNC_DEBOUNCE_MS);
    };
    ydoc.on("update", onUpdate);
    return () => {
      ydoc.off("update", onUpdate);
      window.clearTimeout(timer);
    };
    // Intentionally omit onBodyMarkdownChange identity — use the ref so parent
    // inline callbacks do not re-subscribe every render.
  }, [collab.session?.ydoc, syncBodyPreview]);

  const keepExternalLocal = useCallback(() => {
    setExternalBusy(true);
    void collab
      .resolveExternalWrite(null)
      .then(() => setExternalPrompt(null))
      .finally(() => setExternalBusy(false));
  }, [collab]);

  const useOutsideVersion = useCallback(() => {
    const detail = externalPrompt;
    const ydoc = collab.session?.ydoc;
    if (!detail || !ydoc) return;
    setExternalBusy(true);
    replaceDocumentWithExternalText(ydoc, detail.markdown, detail.title, "markdown");
    void collab
      .resolveExternalWrite(detail.markdown)
      .then(() => {
        setExternalPrompt(null);
        syncBodyPreview("hydrate");
      })
      .finally(() => setExternalBusy(false));
  }, [collab, externalPrompt, syncBodyPreview]);

  const value = useMemo(
    () => ({ ...collab, localDisplayName, onMarkdownChange, registerMarkdownGetter }),
    [collab, localDisplayName, onMarkdownChange, registerMarkdownGetter],
  );

  return (
    <NoteCollabYDocProvider
      ydoc={collab.session?.ydoc ?? null}
      onLocalTitleEdit={collab.scheduleSave}
    >
      <NoteCollabContext.Provider value={value}>
        {children}
        <NotesExternalWriteDialog
          open={externalPrompt !== null}
          noteTitle={documentTitle}
          busy={externalBusy}
          labels={defaultNotesLabels satisfies NotesUILabels}
          onKeepLocal={keepExternalLocal}
          onUseOutside={useOutsideVersion}
        />
      </NoteCollabContext.Provider>
    </NoteCollabYDocProvider>
  );
}

/**
 * Notes footer collab chrome — thin wrapper around shared
 * {@link DocsCollabPresenceChrome} that reads peers from {@link NoteCollabSession}.
 */
export function NoteCollabChrome({ className }: { className?: string }) {
  const { session, peers, connectingPeers, warningPeers } = useNoteCollabContext();
  const awarenessPresencePeers = useDocsCollabAwarenessPresence(session?.awareness);
  const presencePeers = useMemo(
    () =>
      session ? mergeCollabPresencePeers(awarenessPresencePeers, peers, session.user.name) : [],
    [awarenessPresencePeers, peers, session],
  );

  if (!session) {
    return null;
  }

  return (
    <DocsCollabPresenceChrome
      className={className}
      localUser={{ displayName: session.user.name }}
      peers={presencePeers}
      connectingPeers={connectingPeers}
      warningPeers={warningPeers}
    />
  );
}

export function NoteCollabEditorSurface({
  className,
  editable = true,
  autofocus,
}: {
  className?: string;
  /** When false, TipTap rejects typing (view-only share). */
  editable?: boolean;
  /** Override TipTap mount focus. Omit to focus end without scrolling the caret into view. */
  autofocus?: UseEditorOptions["autofocus"];
}) {
  const { session, onMarkdownChange, registerMarkdownGetter } = useNoteCollabContext();

  const handleEditorReady = useCallback(
    (editor: Editor | null) => {
      if (editor) registerMarkdownGetter(() => getAcceptedTextEditorContent(editor, "markdown"));
    },
    [registerMarkdownGetter],
  );

  if (!session) {
    return <div className={cn("note-text-editor-body text-editor", className)} aria-busy="true" />;
  }

  return (
    <DocsCollabEditor
      ydoc={session.ydoc}
      awareness={session.awareness}
      user={session.user}
      format="markdown"
      formatBar={false}
      editable={editable}
      autofocus={autofocus}
      className={cn("note-text-editor-body", className)}
      onContentChange={onMarkdownChange}
      onEditorReady={handleEditorReady}
    />
  );
}

function NoteSoloBody({
  initialMarkdown,
  editable,
  className,
}: {
  initialMarkdown: string;
  editable: boolean;
  className?: string;
}) {
  const editor = useTextEditor({
    format: "markdown",
    content: initialMarkdown,
    editable,
    autofocus: false,
    placeholder: "Press '/' for commands…",
  });

  return (
    <div
      className={cn("note-text-editor-body text-editor", className)}
      data-workspace-detail-editor
    >
      <TextEditorSheet editor={editor} variant="sheet" />
    </div>
  );
}

/**
 * Markdown note body. Editable notes use the Docs Yjs collab editor (when a
 * {@link NoteCollabConfig} is supplied); read-only previews and Storybook use a
 * solo, non-persisting editor.
 */
export function NoteTextEditorBody({
  noteId,
  contentRevision = "",
  initialMarkdown,
  readOnly = false,
  collab,
  className,
}: NoteTextEditorBodyProps) {
  if (!readOnly && collab) {
    return (
      <NoteCollabSession
        key={collab.urls.room ?? noteId}
        initialMarkdown={initialMarkdown}
        userName={collab.userName}
        urls={collab.urls}
        wire={collab.wire}
        localDisplayName={collab.userName}
      >
        <NoteCollabEditorSurface className={className} />
      </NoteCollabSession>
    );
  }

  return (
    <NoteSoloBody
      key={`${noteId}:${contentRevision}`}
      initialMarkdown={initialMarkdown}
      editable={!readOnly}
      className={className}
    />
  );
}
