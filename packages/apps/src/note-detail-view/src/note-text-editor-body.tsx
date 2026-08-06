import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { cn } from "@/lib/utils";
import { docsLabels } from "@/docs-core/src/docs-labels";
import { useConnectivity } from "@/hooks/use-connectivity";
import { LoadingSpinner } from "@/loading-spinner/src/loading-spinner";
import { getAcceptedTextEditorContent } from "@/text-editor-core/src/text-editor-track-changes";
import { TextEditorSheet } from "@/text-editor-core/src/text-editor-sheet";
import { useTextEditor } from "@/text-editor-core/src/use-text-editor";
import {
  DocsCollabEditor,
  DocsCollabPresence,
  mergeCollabPresencePeers,
  useDocsCollab,
  useDocsCollabAwarenessPresence,
} from "@/text-editor-core/docs-collab";
import type { DocsCollabUrls } from "@/text-editor-core/docs-collab";
import type { DocsCollabWireOperations } from "@/text-editor-core/docs-collab/docs-collab-wire";

import "@/text-editor-core/src/text-editor.css";
import "@/note-detail-view/src/note-text-editor-body.css";

/**
 * Configures the body as a live + offline Yjs collab document (Docs #230 stack).
 * Room = the note's virtual path on the shared `wgw_files` tree.
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
  children: ReactNode;
};

/** Single Yjs collab session for a note body; wraps detail chrome + editor. */
export function NoteCollabSession({
  userName,
  urls,
  wire,
  initialMarkdown,
  localDisplayName,
  children,
}: NoteCollabSessionProps) {
  const collab = useDocsCollab({
    userName,
    autoJoin: true,
    urls,
    wire,
    seedContent: initialMarkdown,
  });

  const value = { ...collab, localDisplayName };

  return <NoteCollabContext.Provider value={value}>{children}</NoteCollabContext.Provider>;
}

/** Docs-style peer avatars + pending-sync spinner for the notes detail action bar. */
export function NoteCollabChrome({ className }: { className?: string }) {
  const { session, peers, connectingPeers, warningPeers, pendingSync, failedSync } =
    useNoteCollabContext();
  const awarenessPresencePeers = useDocsCollabAwarenessPresence(session?.awareness);
  const presencePeers = useMemo(
    () =>
      session ? mergeCollabPresencePeers(awarenessPresencePeers, peers, session.user.name) : [],
    [awarenessPresencePeers, peers, session],
  );
  const { online } = useConnectivity();
  const labels = docsLabels;
  const showPendingSyncIndicator = pendingSync && (!online || failedSync);
  const pendingSyncLabel = failedSync ? labels.pendingSyncFailed : labels.pendingSync;

  if (!session && !showPendingSyncIndicator) {
    return null;
  }

  return (
    <div className={cn("note-detail-view__collab-chrome", className)}>
      {showPendingSyncIndicator ? (
        <span
          className="note-detail-view__pending-sync"
          role="status"
          aria-live="polite"
          aria-label={pendingSyncLabel}
        >
          <LoadingSpinner size="sm" />
        </span>
      ) : null}
      {session ? (
        <DocsCollabPresence
          localUser={{ displayName: session.user.name }}
          peers={presencePeers}
          connectingPeers={connectingPeers}
          warningPeers={warningPeers}
        />
      ) : null}
    </div>
  );
}

export function NoteCollabEditorSurface({ className }: { className?: string }) {
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
