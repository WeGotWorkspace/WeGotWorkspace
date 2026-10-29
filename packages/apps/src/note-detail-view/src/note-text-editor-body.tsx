import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
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
import {
  useDocsExternalWritePrompt,
  useDocsExternalWriteRequest,
} from "@/text-editor-core/docs-collab/use-docs-external-write-prompt";
import { NotesExternalWriteDialog } from "@/notes-core/src/notes-external-write-dialog";
import { defaultNotesLabels, type NotesUILabels } from "@/notes-core/src/notes-labels";

import { NoteCollabYDocProvider } from "@/note-detail-view/src/use-note-title-field";
import {
  useNoteBodyPreviewSync,
  type NoteBodyPreviewListener,
} from "@/note-detail-view/src/use-note-body-preview-sync";
import "@/text-editor-core/src/text-editor.css";
import "@/note-detail-view/src/note-text-editor-body.css";

/** Accessible name of the note body textbox. */
const NOTE_EDITOR_ARIA_LABEL = "Note";

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
  trackChangesUserKey: string;
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
   * `"local-edit"` (default) bumps “Last edited” for real typing. Local edits
   * arrive batched per pause in typing (see {@link useNoteBodyPreviewSync}).
   */
  onBodyMarkdownChange?: NoteBodyPreviewListener;
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
  // A note is always markdown. Its room is a UID, which may end in what looks
  // like a plain-text extension (`…@host.json`).
  const noteUrls = useMemo(() => ({ ...urls, documentFormat: "markdown" as const }), [urls]);
  // The same question chain Docs uses: tied to this room, held until an answer saves.
  const externalWriteRequest = useDocsExternalWriteRequest(noteUrls);
  const collab = useDocsCollab({
    userName,
    autoJoin: true,
    urls: externalWriteRequest.urls,
    wire,
    seedContent: initialMarkdown,
  });
  const { onMarkdownChange: saveOnMarkdownChange, registerMarkdownGetter: registerSaveGetter } =
    collab;
  const {
    noteLocalEdit,
    notifyIfChanged,
    registerMarkdownGetter: registerPreviewGetter,
  } = useNoteBodyPreviewSync(collab.session?.ydoc, onBodyMarkdownChange);

  const onMarkdownChange = useCallback(
    (getMarkdown: () => string) => {
      // The save path reads the markdown once; the list preview waits for a pause.
      saveOnMarkdownChange(getMarkdown);
      noteLocalEdit(getMarkdown);
    },
    [saveOnMarkdownChange, noteLocalEdit],
  );

  const registerMarkdownGetter = useCallback(
    (getMarkdown: () => string) => {
      registerSaveGetter(getMarkdown);
      // Editor just bound to the loaded Yjs doc — push preview without waiting
      // for a local keystroke (Yjs-origin updates are filtered in TipTap).
      registerPreviewGetter(getMarkdown);
    },
    [registerSaveGetter, registerPreviewGetter],
  );

  const onOutsideApplied = useCallback(() => notifyIfChanged("hydrate"), [notifyIfChanged]);
  const externalWrite = useDocsExternalWritePrompt({
    request: externalWriteRequest,
    ydoc: collab.session?.ydoc ?? null,
    resolveExternalWrite: collab.resolveExternalWrite,
    onOutsideApplied,
  });

  const value = useMemo(
    () => ({
      ...collab,
      localDisplayName,
      trackChangesUserKey: `${userName}:${urls.room ?? ""}`,
      onMarkdownChange,
      registerMarkdownGetter,
    }),
    [collab, localDisplayName, userName, urls.room, onMarkdownChange, registerMarkdownGetter],
  );

  return (
    <NoteCollabYDocProvider
      ydoc={collab.session?.ydoc ?? null}
      awareness={collab.session?.awareness ?? null}
      localUserName={collab.session?.user.name}
      onLocalTitleEdit={collab.scheduleSave}
    >
      <NoteCollabContext.Provider value={value}>
        {children}
        <NotesExternalWriteDialog
          open={externalWrite.open}
          noteTitle={documentTitle}
          busy={externalWrite.busy}
          keepLocalDisabled={externalWrite.keepLocalDisabled}
          labels={defaultNotesLabels satisfies NotesUILabels}
          onKeepLocal={externalWrite.keepLocal}
          onUseOutside={externalWrite.useOutside}
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
  const { session, trackChangesUserKey, onMarkdownChange, registerMarkdownGetter } =
    useNoteCollabContext();

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
      trackChangesUserKey={trackChangesUserKey}
      format="markdown"
      formatBar={false}
      editable={editable}
      ariaLabel={NOTE_EDITOR_ARIA_LABEL}
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
    ariaLabel: NOTE_EDITOR_ARIA_LABEL,
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
