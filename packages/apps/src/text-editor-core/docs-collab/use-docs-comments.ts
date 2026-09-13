import { useMemo, useRef } from "react";
import type { Editor } from "@tiptap/react";
import type * as Y from "yjs";
import { isPersistedOpenThread } from "./docs-comments-map";
import type { DocsCommentAuthor, DocsCommentThread } from "./docs-comments-types";
import { createDocsThreadsMemory, type DocsThreadsMemoryClient } from "./docs-threads-memory";
import type { DocsThreadsClient } from "./docs-threads-types";
import { useDocsCommentsActive } from "./use-docs-comments-active";
import { useDocsCommentsDraft } from "./use-docs-comments-draft";
import { useDocsCommentsMutations } from "./use-docs-comments-mutations";
import { useDocsCommentsOutsideClick } from "./use-docs-comments-outside-click";
import { useDocsCommentsSelection } from "./use-docs-comments-selection";
import { useDocsCommentsSelectionVersion } from "./use-docs-comments-selection-version";
import { useDocsCommentsSync } from "./use-docs-comments-sync";
import { useDocsCommentsThreadActions } from "./use-docs-comments-thread-actions";
import { useDocsCommentsVisibilityCleanup } from "./use-docs-comments-visibility";
import { useDocsThreadsSource, type DocsThreadsSource } from "./use-docs-threads-source";

export type UseDocsCommentsOptions = {
  ydoc: Y.Doc | null;
  editor: Editor | null;
  currentUser: DocsCommentAuthor;
  /** When false, selection does not open drafts or comment compose UI. */
  commentsVisible?: boolean;
  /** When false, create/reply/resolve/react are no-ops (view-only shares). */
  canMutateComments?: boolean;
  /** Drive virtual path (`/users/…`). Required for live persist. */
  docPath?: string | null;
  threadsClient?: DocsThreadsClient | null;
  /** Shared source from the Doc workspace so comments + suggestions share one list. */
  threadsSource?: DocsThreadsSource;
  pollThreads?: boolean;
};

export type UseDocsCommentsResult = {
  threads: DocsCommentThread[];
  openThreads: DocsCommentThread[];
  draftThread: DocsCommentThread | null;
  activeThreadId: string | null;
  canAddComment: boolean;
  /** True when the current selection can start a draft (ignores comments visibility). */
  selectionQualifiesForComment: boolean;
  selectThread: (threadId: string) => void;
  activateThreadFromMark: (threadId: string, clickPos?: number) => void;
  clearActiveThread: () => void;
  createThreadFromSelection: () => string | null;
  cancelDraft: () => void;
  submitDraftComment: (body: string) => void;
  addReply: (threadId: string, body: string) => void;
  toggleReaction: (threadId: string, emoji: string) => void;
  resolveThread: (threadId: string) => void;
  deleteThread: (threadId: string) => void;
};

export { getDocsCommentsMap } from "./docs-comments-map";

const FALLBACK_DOC_PATH = "/users/bob/docs/plan.md";

function isMemoryClient(client: DocsThreadsClient): client is DocsThreadsMemoryClient {
  return "setActor" in client;
}

export function useDocsComments({
  ydoc,
  editor,
  currentUser,
  commentsVisible = true,
  canMutateComments = true,
  docPath = null,
  threadsClient,
  threadsSource,
  pollThreads = false,
}: UseDocsCommentsOptions): UseDocsCommentsResult {
  const fallbackClient = useRef<DocsThreadsClient | null>(null);
  if (fallbackClient.current == null && threadsClient == null) {
    fallbackClient.current = createDocsThreadsMemory(docPath ?? FALLBACK_DOC_PATH, currentUser);
  }
  const resolvedClient = threadsClient ?? fallbackClient.current;
  if (resolvedClient && isMemoryClient(resolvedClient)) {
    resolvedClient.setActor(currentUser);
  }

  const ownedSource = useDocsThreadsSource({
    client: threadsSource ? null : resolvedClient,
    path: threadsSource ? null : (docPath ?? FALLBACK_DOC_PATH),
    poll: Boolean(pollThreads && !threadsSource),
  });
  const source = threadsSource ?? ownedSource;

  const { selectionVersion, bumpSelectionVersion } = useDocsCommentsSelectionVersion();
  const {
    activeThreadId,
    activeThreadIdRef,
    dismissedSelectionRef,
    setActiveThreadId,
    clearActiveThread,
  } = useDocsCommentsActive(editor);
  const threads = source.comments;
  useDocsCommentsSync(editor, threads);

  const openThreads = useMemo(() => threads.filter(isPersistedOpenThread), [threads]);
  const openThreadIds = useMemo(
    () => new Set(openThreads.map((thread) => thread.id)),
    [openThreads],
  );

  const { draftThread, draftThreadRef, setDraftThread, cancelDraft } = useDocsCommentsDraft({
    editor,
    commentsVisible: commentsVisible && canMutateComments,
    bumpSelectionVersion,
    setActiveThreadId,
  });

  const { selectThread, activateThreadFromMark, createThreadFromSelection } =
    useDocsCommentsThreadActions({
      ydoc,
      editor,
      currentUser,
      openThreads,
      openThreadIds,
      activeThreadIdRef,
      dismissedSelectionRef,
      draftThreadRef,
      setActiveThreadId,
      setDraftThread,
      cancelDraft,
      canMutateComments,
    });

  const { selectionQualifiesForComment } = useDocsCommentsSelection({
    editor,
    commentsVisible: commentsVisible && canMutateComments,
    selectionVersion,
    bumpSelectionVersion,
    openThreadIds,
    draftThreadRef,
    activeThreadIdRef,
    dismissedSelectionRef,
    activateThreadFromMark,
  });

  const canAddComment = useMemo(() => {
    if (!canMutateComments || !commentsVisible || !editor) return false;
    return selectionQualifiesForComment;
  }, [canMutateComments, commentsVisible, editor, selectionQualifiesForComment]);

  useDocsCommentsOutsideClick({
    editor,
    activeThreadId,
    draftThreadRef,
    clearActiveThread,
  });

  useDocsCommentsVisibilityCleanup({
    commentsVisible: commentsVisible && canMutateComments,
    draftThreadRef,
    activeThreadIdRef,
    cancelDraft,
    clearActiveThread,
  });

  const { addReply, toggleReaction, resolveThread, deleteThread, submitDraftComment } =
    useDocsCommentsMutations({
      client: resolvedClient,
      path: docPath ?? FALLBACK_DOC_PATH,
      source,
      editor,
      currentUser,
      activeThreadId,
      draftThreadRef,
      setDraftThread,
      setActiveThreadId,
      cancelDraft,
      canMutateComments,
    });

  return {
    threads,
    openThreads,
    draftThread,
    activeThreadId,
    canAddComment,
    selectionQualifiesForComment: canMutateComments && selectionQualifiesForComment,
    selectThread,
    activateThreadFromMark,
    createThreadFromSelection,
    cancelDraft,
    submitDraftComment,
    addReply,
    toggleReaction,
    resolveThread,
    deleteThread,
  };
}
