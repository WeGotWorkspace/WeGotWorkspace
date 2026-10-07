import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { MessageSquare } from "lucide-react";
import { IconButton } from "@/button/src/button";
import { AppSidebar } from "@/app-sidebar/src/app-sidebar";
import { docsLabels } from "@/docs-core/src/docs-labels";
import type { DocsCollabUiPermissions } from "@/docs-core/src/docs-collab-permissions";
import {
  resolveDocsCollabFormatBarMode,
  resolveDocsCollabPermissions,
} from "@/docs-core/src/docs-collab-permissions";
import { docsEditorFormatFromFileName } from "@/docs-core/src/docs-editor-format";
import { DocsHeaderActions } from "@/docs-core/src/docs-header-actions";
import { formatDocLastEdited } from "@/docs-core/src/docs-last-edited";
import { DocsOutlineSidebar } from "@/docs-core/src/docs-outline-sidebar";
import { focusOutlineHeading, parseMarkdownOutline } from "@/docs-core/src/docs-outline";
import { DocsStatsTags } from "@/docs-core/src/docs-stats-tags";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import { workspaceUserInitials } from "@/lib/workspace/workspace-session";
import { cn } from "@/lib/utils";
import { useAppToast } from "@/hooks/use-app-toast";
import { useConnectivity } from "@/hooks/use-connectivity";
import { useSyncRetryToast } from "@/hooks/use-sync-retry-toast";
import type { DriveAPIOperations } from "@/drive-core/src/drive-types";
import {
  isSaveFailureDocStatus,
  isToastDocStatus,
  isTransientDocStatus,
} from "./docs-collab-status";
import {
  shouldAutoOpenCommentsForDraft,
  shouldAutoOpenCommentsForThreads,
  useDocsCommentsLayout,
} from "./use-docs-comments-layout";
import { TooltipProvider } from "@/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog";
import { ViewHeader } from "@/view-header/src/view-header";
import {
  getAcceptedTextEditorContent,
  getTrackChangesMode,
} from "@/text-editor-core/src/text-editor-track-changes";
import { TEXT_EDITOR_FORMAT_BAR_FULL } from "@/text-editor-core/src/text-editor-format-bar-config";
import { detailFooterLastEditedTag } from "@/workspace-shell/src/detail-footer-last-edited-tag";
import { WorkspaceDetailFooter } from "@/workspace-shell/src/workspace-detail-footer";
import { DocsCollabEditor } from "./docs-collab-editor";
import { DocsCollabRelayBanner } from "./docs-collab-relay-banner";
import { DocsImagePickerDialog } from "./docs-image-picker-dialog";
import { useDocsImageInsert } from "./use-docs-image-insert";
import { DocsCollabSuggestControls } from "./docs-collab-suggest-controls";
import { docsCollabHeaderActions } from "./docs-collab-header-actions";
import { mergeCollabPresencePeers } from "./docs-collab-presence-peers";
import { DocsCollabPresenceChrome } from "./docs-collab-presence-chrome";
import { DocsCollabStatusIndicator } from "./docs-collab-status-indicator";
import { useDocsCollabStatusIndicator } from "./use-docs-collab-status-indicator";
import { useDocsCollabReviewSurfaces } from "./use-docs-collab-review-surfaces";
import type { DocsCollabWireOperations } from "./docs-collab-wire";
import { useDocsCollabAwarenessPresence } from "./use-docs-collab-awareness-presence";
import { useDocsComments } from "./use-docs-comments";
import { useDocsSuggestions } from "./use-docs-suggestions";
import { useDocsCollab } from "./use-docs-collab";
import type { DocsCollabUrls } from "./use-docs-collab";
import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import { createDocsThreadsLiveClient } from "./docs-threads-live";
import { createDocsThreadsMemory } from "./docs-threads-memory";
import { docsThreadsPathFromRoom } from "./docs-threads-path";
import { useDocsThreadsSource } from "./use-docs-threads-source";
import { useDocsCollabFailedSync } from "./use-docs-collab-failed-sync";
import { useDocsCollabUserName } from "./use-docs-collab-user-name";
import { useDocsConflictResolution } from "./use-docs-conflict-resolution";
import { DocsConflictDialog } from "./docs-conflict-dialog";
import {
  WorkspaceAppLayout,
  WorkspaceUserFooter,
} from "@/workspace-shell/src/workspace-app-layout";
import { isSidebarOverlayViewport } from "@/workspace-shell/src/sidebar-breakpoint";

import "@/docs-core/src/docs-workspace.css";
import "@/text-editor-core/docs-collab/docs-collab-review/docs-collab-review-panel.css";

export type DocsCollabWorkspaceProps = {
  /** When set (e.g. tests), skips the on-load `window.prompt`. */
  userName?: string;
  /** Optional document title shown in the header (defaults to together.md). */
  documentTitle?: string;
  /** Optional transport/doc endpoints for step-by-step backend migration testing. */
  urls?: DocsCollabUrls;
  /** Auth + RTC fetch for live API; defaults to offline mesh. */
  wire?: DocsCollabWireOperations;
  /** Logout handler for the sidebar user footer. */
  onLogout?: () => void;
  /** When set with {@link showShare}, renders Share in the docs header. */
  onShare?: () => void;
  shareLabel?: string;
  showShare?: boolean;
  /**
   * Share grant rights for this document. Omit for Storybook / full access.
   * Pass locked rights while at-path is still loading.
   */
  permissions?: DocsCollabUiPermissions;
  /** Live Drive operations for the image picker + upload (Chunk B/C). */
  driveOperations?: DriveAPIOperations;
  /** Signed-in Drive username for picker path mapping. */
  driveUsername?: string;
  /** Doc virtual path (`/users/…/file.md`) for `.attachments/{docFnId}/` uploads. */
  docApiPath?: string;
};

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function defaultTitleFromRoom(room: string | undefined): string {
  const normalized = room?.trim().replace(/\/+$/, "");
  if (!normalized) return "document.md";
  const slash = normalized.lastIndexOf("/");
  const name = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  return name || "document.md";
}

export function DocsCollabWorkspace({
  userName: userNameProp,
  documentTitle,
  urls,
  wire,
  onLogout,
  onShare,
  shareLabel,
  showShare = false,
  permissions,
  driveOperations,
  driveUsername,
  docApiPath,
}: DocsCollabWorkspaceProps = {}) {
  const { userName, promptDismissed } = useDocsCollabUserName(userNameProp);

  if (!userName) {
    return (
      <div className="docs-workspace flex min-h-screen items-center justify-center">
        <p className="docs-workspace__loading px-6 text-center">
          {promptDismissed ? "A display name is required to join." : "Loading…"}
        </p>
      </div>
    );
  }

  return (
    <DocsCollabWorkspaceInner
      userName={userName}
      documentTitle={documentTitle}
      urls={urls}
      wire={wire}
      onLogout={onLogout}
      onShare={onShare}
      shareLabel={shareLabel}
      showShare={showShare}
      permissions={permissions ?? resolveDocsCollabPermissions(undefined)}
      driveOperations={driveOperations}
      driveUsername={driveUsername}
      docApiPath={docApiPath}
    />
  );
}

function DocsCollabWorkspaceInner({
  userName,
  documentTitle,
  urls,
  wire,
  onLogout,
  onShare,
  shareLabel,
  showShare = false,
  permissions,
  driveOperations,
  driveUsername,
  docApiPath,
}: {
  userName: string;
  documentTitle?: string;
  urls?: DocsCollabUrls;
  wire?: DocsCollabWireOperations;
  onLogout?: () => void;
  onShare?: () => void;
  shareLabel?: string;
  showShare?: boolean;
  permissions: DocsCollabUiPermissions;
  driveOperations?: DriveAPIOperations;
  driveUsername?: string;
  docApiPath?: string;
}) {
  const labels = docsLabels;
  const formatBarMode = resolveDocsCollabFormatBarMode(permissions);
  const session = useMemo(
    () => ({
      ...mockWorkspaceSession,
      user: {
        ...mockWorkspaceSession.user,
        displayName: userName,
        username: userName.toLowerCase().replace(/\s+/g, "."),
      },
    }),
    [userName],
  );

  const {
    session: collabSession,
    peers,
    connectingPeers,
    warningPeers,
    docStatus,
    lastSavedAt,
    pendingSync,
    failedSync,
    relayBanner,
    saveNow,
    onMarkdownChange,
    registerMarkdownGetter,
  } = useDocsCollab({
    userName,
    autoJoin: true,
    urls,
    wire,
  });
  const showFailedSync = useDocsCollabFailedSync(urls?.room);
  const docPath = docsThreadsPathFromRoom(urls?.room);
  const liveThreads = Boolean(docPath) && wgwLiveApiEnabled();
  const threadsClient = useMemo(
    () =>
      liveThreads
        ? createDocsThreadsLiveClient()
        : createDocsThreadsMemory(docPath ?? "/docs/test-together.md", {
            id: session.user.username ?? session.user.displayName,
            name: session.user.displayName?.trim() || session.user.username || "User",
          }),
    [docPath, liveThreads, session.user.displayName, session.user.username],
  );
  const threadsSource = useDocsThreadsSource({
    client: threadsClient,
    path: docPath ?? "/docs/test-together.md",
    poll: liveThreads,
  });

  const handleRetrySync = useCallback(() => {
    void saveNow().catch(() => undefined);
  }, [saveNow]);
  useSyncRetryToast({
    active: showFailedSync,
    title: labels.syncFailedTitle,
    message: labels.syncFailedMessage,
    retryLabel: labels.retrySync,
    onRetry: handleRetrySync,
  });
  const awarenessPresencePeers = useDocsCollabAwarenessPresence(collabSession?.awareness);
  const presencePeers = useMemo(
    () =>
      collabSession
        ? mergeCollabPresencePeers(awarenessPresencePeers, peers, collabSession.user.name)
        : [],
    [awarenessPresencePeers, collabSession, peers],
  );

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [reviewPanelOpen, setReviewPanelOpen] = useState(false);
  const [viewSource, setViewSource] = useState(false);
  const [sourceClosedDialogOpen, setSourceClosedDialogOpen] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [markdown, setMarkdown] = useState("");
  const [activeOutlineIndex, setActiveOutlineIndex] = useState<number | null>(null);
  const resolvedDocumentTitle = documentTitle?.trim() || defaultTitleFromRoom(urls?.room);
  const editorFormat = docsEditorFormatFromFileName(resolvedDocumentTitle);
  const showMarkdownOutline = resolvedDocumentTitle.toLowerCase().endsWith(".md");
  const imageInsertEnabled = permissions.editable && editorFormat !== "text";
  const resolvedDocApiPath = docApiPath ?? (urls?.room ? `/${urls.room}` : null);
  const pickerUsername = driveUsername?.trim() || session.user.username || "";
  const imageInsert = useDocsImageInsert({
    editor,
    docApiPath: resolvedDocApiPath,
    operations: driveOperations,
    enabled: imageInsertEnabled,
    insertErrorMessage: labels.insertImageError,
  });
  const { online } = useConnectivity();
  const { showSuccess, showError } = useAppToast();
  const commentsLayout = useDocsCommentsLayout();
  const useCommentsDrawer = commentsLayout === "drawer";
  const showPendingSyncIndicator = pendingSync && (!online || failedSync);
  const pendingSyncLabel = failedSync ? labels.pendingSyncFailed : labels.pendingSync;
  const footerDocStatus = docStatus && !isToastDocStatus(docStatus) ? docStatus : "";
  const statusIndicator = useDocsCollabStatusIndicator({
    docStatus: footerDocStatus,
    online,
    pendingSync,
    failedSync,
    lastSavedAt,
    liveNames: presencePeers.map((peer) => peer.name),
    unreachableCount: warningPeers.length,
  });

  const toastedDocStatusRef = useRef<string>("");
  useEffect(() => {
    if (!docStatus || !isToastDocStatus(docStatus)) {
      toastedDocStatusRef.current = "";
      return;
    }
    if (toastedDocStatusRef.current === docStatus) return;
    toastedDocStatusRef.current = docStatus;
    if (isTransientDocStatus(docStatus)) {
      showSuccess(docStatus);
      return;
    }
    if (isSaveFailureDocStatus(docStatus)) {
      showError(docStatus);
    }
  }, [docStatus, showError, showSuccess]);

  const comments = useDocsComments({
    ydoc: collabSession?.ydoc ?? null,
    editor,
    currentUser: {
      id: session.user.username ?? session.user.displayName,
      name: session.user.displayName?.trim() || session.user.username || "User",
    },
    commentsVisible: reviewPanelOpen,
    canMutateComments: permissions.canComment,
    docPath,
    threadsClient,
    threadsSource,
    pollThreads: liveThreads,
  });

  const {
    draftThread,
    selectionQualifiesForComment,
    threads: commentThreads,
    openThreads,
    activeThreadId,
    createThreadFromSelection,
    cancelDraft,
    clearActiveThread,
    activateThreadFromMark,
    selectThread,
    addReply,
    toggleReaction,
    resolveThread,
  } = comments;

  const {
    suggestions,
    archivedSuggestions,
    activeChangeId,
    selectSuggestion,
    clearActiveSuggestion,
    activateSuggestionFromMark,
    acceptSuggestion,
    rejectSuggestion,
    addReply: addSuggestionReply,
    toggleReaction: toggleSuggestionReaction,
  } = useDocsSuggestions(editor, {
    ydoc: collabSession?.ydoc ?? null,
    currentUser: {
      id: session.user.username ?? session.user.displayName,
      name: session.user.displayName?.trim() || session.user.username || "User",
    },
    docPath,
    threadsClient,
    threadsSource,
    pollThreads: liveThreads,
  });

  useEffect(() => {
    if (viewSource) return;
    if (shouldAutoOpenCommentsForDraft(draftThread)) {
      setReviewPanelOpen(true);
      return;
    }
    if (!shouldAutoOpenCommentsForThreads(commentsLayout)) return;
    if (openThreads.length > 0 || suggestions.length > 0) {
      setReviewPanelOpen(true);
    }
  }, [commentsLayout, draftThread, openThreads.length, suggestions.length, viewSource]);

  const handleReviewClose = useCallback(() => {
    cancelDraft();
    clearActiveThread();
    clearActiveSuggestion();
    setReviewPanelOpen(false);
  }, [cancelDraft, clearActiveSuggestion, clearActiveThread]);

  useEffect(() => {
    if (!viewSource) return;
    if (reviewPanelOpen || draftThread) {
      handleReviewClose();
    }
  }, [draftThread, handleReviewClose, reviewPanelOpen, viewSource]);

  const handleCommentActivated = useCallback(
    (commentId: string, clickPos: number) => {
      if (viewSource) return;
      setReviewPanelOpen(true);
      activateThreadFromMark(commentId, clickPos);
    },
    [activateThreadFromMark, viewSource],
  );

  const handleAddCommentFromSelection = useCallback(() => {
    if (viewSource || !collabSession || !permissions.canComment) return;
    setReviewPanelOpen(true);
    if (draftThread) {
      selectThread(draftThread.id);
      return;
    }
    if (selectionQualifiesForComment) {
      createThreadFromSelection();
    }
  }, [
    collabSession,
    createThreadFromSelection,
    draftThread,
    permissions.canComment,
    selectThread,
    selectionQualifiesForComment,
    viewSource,
  ]);

  const handleToggleReview = useCallback(() => {
    if (viewSource) return;
    if (reviewPanelOpen) {
      handleReviewClose();
      return;
    }
    setReviewPanelOpen(true);
  }, [handleReviewClose, reviewPanelOpen, viewSource]);

  const handleSuggestionActivated = useCallback(
    (changeId: string) => {
      if (viewSource) return;
      setReviewPanelOpen(true);
      activateSuggestionFromMark(changeId);
    },
    [activateSuggestionFromMark, viewSource],
  );

  const reviewItemCount = openThreads.length + suggestions.length;

  const { sidebar: reviewSidebar, drawer: reviewDrawer } = useDocsCollabReviewSurfaces({
    active: Boolean(collabSession),
    open: reviewPanelOpen,
    useDrawer: useCommentsDrawer,
    onClose: handleReviewClose,
    editor,
    labels,
    threads: commentThreads,
    draftThread,
    suggestions,
    archivedSuggestions,
    currentUserId: session.user.username,
    activeThreadId,
    activeChangeId,
    canMutateComments: permissions.canComment,
    canReviewSuggestions: permissions.canReview,
    onSelectThread: selectThread,
    onAddReply: addReply,
    onToggleReaction: toggleReaction,
    onResolveThread: resolveThread,
    onCancelDraft: cancelDraft,
    onSelectSuggestion: selectSuggestion,
    onAcceptSuggestion: acceptSuggestion,
    onRejectSuggestion: rejectSuggestion,
    onAddSuggestionReply: addSuggestionReply,
    onToggleSuggestionReaction: toggleSuggestionReaction,
  });

  const outline = useMemo(
    () => (showMarkdownOutline ? parseMarkdownOutline(markdown) : []),
    [markdown, showMarkdownOutline],
  );

  const handleMarkdownChange = useCallback(
    (getContent: () => string) => {
      onMarkdownChange(getContent);
      setMarkdown(getContent());
    },
    [onMarkdownChange],
  );

  useEffect(() => {
    if (!editor) return;

    const updateFromEditor = () => {
      setMarkdown(getAcceptedTextEditorContent(editor, editorFormat));
    };

    updateFromEditor();
    editor.on("transaction", updateFromEditor);
    return () => {
      editor.off("transaction", updateFromEditor);
    };
  }, [editor, editorFormat]);

  const handleEditorReady = useCallback(
    (nextEditor: Editor | null) => {
      setEditor(nextEditor);
      if (nextEditor) {
        const getContent = () => getAcceptedTextEditorContent(nextEditor, editorFormat);
        setMarkdown(getContent());
        registerMarkdownGetter(getContent);
      }
    },
    [editorFormat, registerMarkdownGetter],
  );

  const handleOutlineSelect = useCallback(
    (index: number) => {
      setActiveOutlineIndex(index);
      if (editor) focusOutlineHeading(editor, index);
      if (isSidebarOverlayViewport()) {
        setSidebarOpen(false);
      }
    },
    [editor],
  );

  const wordCount = useMemo(() => countWords(markdown), [markdown]);
  const characterCount = markdown.length;
  const sourceLockedByCollab = Boolean(collabSession) && presencePeers.length > 0;

  const handleServerDocApplied = useCallback(() => {
    if (editor) {
      setMarkdown(getAcceptedTextEditorContent(editor, editorFormat));
    }
  }, [editor, editorFormat]);

  const conflict = useDocsConflictResolution({
    room: urls?.room,
    ydoc: collabSession?.ydoc ?? null,
    yjsUrl: urls?.yjsUrl,
    authToken: urls?.authToken,
    saveNow,
    onServerApplied: handleServerDocApplied,
  });

  useEffect(() => {
    if (!sourceLockedByCollab || !viewSource) return;
    setViewSource(false);
    setSourceClosedDialogOpen(true);
  }, [sourceLockedByCollab, viewSource]);

  useEffect(() => {
    if (!viewSource || !editor) return;
    if (getTrackChangesMode(editor) !== "suggest") return;
    editor.commands.setEditMode();
  }, [editor, viewSource]);

  return (
    <TooltipProvider delayDuration={200}>
      <>
        <WorkspaceAppLayout
          className={cn("docs-workspace", "min-h-screen")}
          panel={reviewSidebar}
          sidebar={
            <AppSidebar
              open={sidebarOpen}
              onCloseMobile={() => setSidebarOpen(false)}
              appSwitchSubtitle="Docs"
              footer={
                <WorkspaceUserFooter
                  name={session.user.displayName}
                  initials={workspaceUserInitials(session.user)}
                  detailLine={session.user.username}
                  onLogoutClick={onLogout}
                />
              }
            >
              {showMarkdownOutline ? (
                <DocsOutlineSidebar
                  labels={labels}
                  items={outline}
                  activeIndex={activeOutlineIndex}
                  onSelect={handleOutlineSelect}
                />
              ) : null}
            </AppSidebar>
          }
          mainHeader={
            <ViewHeader
              title={resolvedDocumentTitle}
              sidebarOpen={sidebarOpen}
              onToggleSidebar={() => setSidebarOpen((open) => !open)}
              titleTrailing={
                <IconButton
                  label={
                    viewSource
                      ? "Review is disabled in source view"
                      : reviewPanelOpen
                        ? labels.reviewToggleHide
                        : reviewItemCount > 0
                          ? `${labels.reviewToggleShow} (${reviewItemCount})`
                          : labels.reviewToggleShow
                  }
                  icon={<MessageSquare />}
                  size="md"
                  variant="outline"
                  active={reviewPanelOpen}
                  disabled={viewSource}
                  className="docs-workspace__review-toggle"
                  data-count={reviewItemCount > 0 ? reviewItemCount : undefined}
                  aria-pressed={reviewPanelOpen}
                  onClick={handleToggleReview}
                />
              }
              actions={
                <DocsHeaderActions
                  leading={
                    permissions.editable ? (
                      <DocsCollabSuggestControls editor={editor} disabled={viewSource} />
                    ) : undefined
                  }
                  actions={docsCollabHeaderActions({
                    labels,
                    editor,
                    viewSource,
                    onToggleViewSource: () => setViewSource((on) => !on),
                    sourceLockedByCollab,
                    reviewPanelOpen,
                    share:
                      showShare && onShare
                        ? { label: shareLabel ?? labels.share, onClick: onShare }
                        : undefined,
                  })}
                />
              }
            />
          }
          main={
            <div className="docs-workspace__editor">
              {relayBanner ? <DocsCollabRelayBanner copy={relayBanner} /> : null}
              {collabSession ? (
                <DocsCollabEditor
                  key={`${urls?.room ?? "doc"}-${collabSession.mountId}`}
                  ydoc={collabSession.ydoc}
                  awareness={collabSession.awareness}
                  user={collabSession.user}
                  format={editorFormat}
                  sheetFill
                  viewSource={viewSource}
                  editable={permissions.editable}
                  formattingDisabled={formatBarMode === "commentOnly"}
                  formatBar={
                    editorFormat === "text" || formatBarMode === "hidden"
                      ? false
                      : { groups: TEXT_EDITOR_FORMAT_BAR_FULL, showPrint: false }
                  }
                  onContentChange={handleMarkdownChange}
                  onEditorReady={handleEditorReady}
                  onCommentActivated={handleCommentActivated}
                  onSuggestionActivated={handleSuggestionActivated}
                  onAddCommentFromSelection={handleAddCommentFromSelection}
                  canAddCommentFromSelection={
                    permissions.canComment && selectionQualifiesForComment
                  }
                  commentsDisabled={viewSource || !permissions.canComment}
                  commentsDisabledTitle={
                    viewSource
                      ? labels.commentsAddFromSelectionDisabledViewSource
                      : labels.commentsAddFromSelectionDisabledReadOnly
                  }
                  commentControlLabels={labels}
                  onInsertImage={imageInsertEnabled ? imageInsert.openPicker : undefined}
                />
              ) : null}
              <WorkspaceDetailFooter
                className="docs-workspace__stats-footer"
                start={
                  collabSession ? (
                    <DocsCollabPresenceChrome
                      localUser={{
                        displayName: collabSession.user.name,
                      }}
                      peers={presencePeers}
                      connectingPeers={connectingPeers}
                      warningPeers={warningPeers}
                    />
                  ) : undefined
                }
                tags={
                  <>
                    <DocsStatsTags
                      wordCount={wordCount}
                      characterCount={characterCount}
                      statsWordsLabel={labels.statsWords}
                      statsCharactersLabel={labels.statsCharacters}
                    />
                    {detailFooterLastEditedTag({
                      lastEdited: formatDocLastEdited(lastSavedAt),
                      editedLabel: labels.editedLabel,
                      busy: showPendingSyncIndicator,
                      busyLabel: pendingSyncLabel,
                    })}
                  </>
                }
                end={<DocsCollabStatusIndicator indicator={statusIndicator} />}
              />
            </div>
          }
        />
        {reviewDrawer}
        <DocsImagePickerDialog
          open={imageInsert.pickerOpen}
          operations={driveOperations}
          currentUsername={pickerUsername}
          groupRoots={imageInsert.groupRoots}
          onClose={imageInsert.closePicker}
          onSelectFile={imageInsert.onSelectFile}
          onUploadFiles={imageInsert.onUploadFiles}
        />
        <DocsConflictDialog
          open={conflict.open}
          documentTitle={resolvedDocumentTitle}
          busy={conflict.busy}
          labels={labels}
          onKeepLocal={conflict.keepLocal}
          onUseServer={conflict.useServer}
          onOpenChange={conflict.setOpen}
        />
        <AlertDialog open={sourceClosedDialogOpen} onOpenChange={setSourceClosedDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Source view closed</AlertDialogTitle>
              <AlertDialogDescription>
                Another collaborator connected to this document, so source view was turned off.
                Source view is only available when you are the only editor in the room.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogAction onClick={() => setSourceClosedDialogOpen(false)}>
                Got it
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    </TooltipProvider>
  );
}
