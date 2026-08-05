import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import type { Editor } from "@tiptap/react";
import { Code2, MessageSquare, Printer, Share2 } from "lucide-react";
import { LoadingSpinner } from "@/loading-spinner/src/loading-spinner";
import { AppSidebar } from "@/app-sidebar/src/app-sidebar";
import { docsLabels } from "@/docs-core/src/docs-labels";
import type { DocsCollabUiPermissions } from "@/docs-core/src/docs-collab-permissions";
import {
  resolveDocsCollabFormatBarMode,
  resolveDocsCollabPermissions,
} from "@/docs-core/src/docs-collab-permissions";
import { DocsDocStatus } from "@/docs-core/src/docs-doc-status";
import { DocsEditorStatsFooter } from "@/docs-core/src/docs-stats-footer";
import { DocsHeaderActions } from "@/docs-core/src/docs-header-actions";
import { docsEditorFormatFromFileName } from "@/docs-core/src/docs-editor-format";
import { DocsOutlineSidebar } from "@/docs-core/src/docs-outline-sidebar";
import { focusOutlineHeading, parseMarkdownOutline } from "@/docs-core/src/docs-outline";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import { workspaceUserInitials } from "@/lib/workspace/workspace-session";
import { cn } from "@/lib/utils";
import { useConnectivity } from "@/hooks/use-connectivity";
import { useSyncRetryToast } from "@/hooks/use-sync-retry-toast";
import {
  shouldAutoOpenCommentsForDraft,
  shouldAutoOpenCommentsForThreads,
  useDocsCommentsLayout,
} from "./use-docs-comments-layout";
import { SideDrawer } from "@/ui/side-drawer";
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
import { getAcceptedTextEditorContent } from "@/text-editor-core/src/text-editor-track-changes";
import { TEXT_EDITOR_FORMAT_BAR_FULL } from "@/text-editor-core/src/text-editor-format-bar-config";
import { printTextEditorSheet } from "@/text-editor-core/src/text-editor-print";
import { DocsCollabEditor } from "./docs-collab-editor";
import { mergeCollabPresencePeers } from "./docs-collab-presence-peers";
import { DocsCollabPresence } from "./docs-collab-presence";
import { DocsCollabReviewPanel } from "./docs-collab-review/docs-collab-review-panel";
import type { DocsCollabWireOperations } from "./docs-collab-wire";
import { useDocsCollabAwarenessPresence } from "./use-docs-collab-awareness-presence";
import { useDocsComments } from "./use-docs-comments";
import { useDocsSuggestions } from "./use-docs-suggestions";
import { useDocsCollab } from "./use-docs-collab";
import type { DocsCollabUrls } from "./use-docs-collab";
import { useDocsCollabFailedSync } from "./use-docs-collab-failed-sync";
import { DocsConflictDialog } from "./docs-conflict-dialog";
import {
  resolveDocsConflictKeepLocal,
  resolveDocsConflictUseServer,
} from "@/lib/offline/docs/docs-conflict-resolution";
import {
  reportDocsSyncConflicts,
  setDocsSyncConflictListener,
} from "@/lib/offline/docs/docs-sync-conflicts";
import {
  WorkspaceAppLayout,
  WorkspaceUserFooter,
} from "@/workspace-shell/src/workspace-app-layout";

import "@/docs-core/src/docs-workspace.css";
import "@/text-editor-core/docs-collab/docs-collab-review/docs-collab-review-panel.css";

const USERNAME_PROMPT = "Your display name";

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
};

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function promptForUserName(): string | null {
  const input = window.prompt(USERNAME_PROMPT);
  if (input === null) return null;
  const trimmed = input.trim();
  return trimmed || null;
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
}: DocsCollabWorkspaceProps = {}) {
  const [userName, setUserName] = useState<string | null>(() => userNameProp?.trim() || null);
  const [promptDismissed, setPromptDismissed] = useState(false);

  useLayoutEffect(() => {
    if (userNameProp?.trim()) {
      setUserName(userNameProp.trim());
      return;
    }
    if (userName !== null || promptDismissed) return;
    const name = promptForUserName();
    setPromptDismissed(true);
    if (name) setUserName(name);
  }, [userNameProp, userName, promptDismissed]);

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
    pendingSync,
    failedSync,
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
  const [conflictOpen, setConflictOpen] = useState(false);
  const [resolvingConflict, setResolvingConflict] = useState(false);

  useEffect(() => {
    setDocsSyncConflictListener((paths) => {
      if (paths.includes(urls?.room ?? "")) setConflictOpen(true);
    });
    return () => setDocsSyncConflictListener(undefined);
  }, [urls?.room]);

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
  const { online } = useConnectivity();
  const commentsLayout = useDocsCommentsLayout();
  const useCommentsDrawer = commentsLayout === "drawer";
  const showPendingSyncIndicator = pendingSync && (!online || failedSync);
  const pendingSyncLabel = failedSync ? labels.pendingSyncFailed : labels.pendingSync;

  const comments = useDocsComments({
    ydoc: collabSession?.ydoc ?? null,
    editor,
    currentUser: {
      id: session.user.username ?? session.user.displayName,
      name: session.user.displayName?.trim() || session.user.username || "User",
    },
    commentsVisible: reviewPanelOpen,
    canMutateComments: permissions.canComment,
  });

  const {
    draftThread,
    selectionQualifiesForComment,
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

  const reviewPanelContent = useMemo(
    () => (
      <DocsCollabReviewPanel
        editor={editor}
        onCloseMobile={handleReviewClose}
        showCloseButton={useCommentsDrawer}
        labels={labels}
        threads={openThreads}
        draftThread={draftThread}
        suggestions={suggestions}
        currentUserId={session.user.username}
        activeThreadId={activeThreadId}
        activeChangeId={activeChangeId}
        canMutateComments={permissions.canComment}
        canReviewSuggestions={permissions.canReview}
        onSelectThread={selectThread}
        onAddReply={addReply}
        onToggleReaction={toggleReaction}
        onResolveThread={resolveThread}
        onCancelDraft={cancelDraft}
        onSelectSuggestion={selectSuggestion}
        onAcceptSuggestion={acceptSuggestion}
        onRejectSuggestion={rejectSuggestion}
        onAddSuggestionReply={addSuggestionReply}
        onToggleSuggestionReaction={toggleSuggestionReaction}
      />
    ),
    [
      acceptSuggestion,
      activeChangeId,
      activeThreadId,
      addReply,
      addSuggestionReply,
      cancelDraft,
      draftThread,
      editor,
      handleReviewClose,
      labels,
      openThreads,
      permissions.canComment,
      permissions.canReview,
      useCommentsDrawer,
      rejectSuggestion,
      resolveThread,
      selectSuggestion,
      selectThread,
      session.user.username,
      suggestions,
      toggleReaction,
      toggleSuggestionReaction,
    ],
  );

  const reviewSidebar = useMemo(
    () =>
      collabSession && !useCommentsDrawer ? (
        <div
          className="workspace-app-layout__panel docs-workspace__review-panel"
          data-open={reviewPanelOpen ? "true" : "false"}
          aria-hidden={!reviewPanelOpen}
        >
          {reviewPanelContent}
        </div>
      ) : null,
    [collabSession, reviewPanelContent, reviewPanelOpen, useCommentsDrawer],
  );

  const reviewDrawer = useMemo(
    () =>
      collabSession && useCommentsDrawer ? (
        <SideDrawer
          open={reviewPanelOpen}
          onClose={handleReviewClose}
          title={labels.reviewSidebarTitle}
          className="docs-collab-review-panel-drawer"
          contentClassName="docs-collab-review-panel-drawer__body"
        >
          {reviewPanelContent}
        </SideDrawer>
      ) : null,
    [
      collabSession,
      handleReviewClose,
      labels.reviewSidebarTitle,
      reviewPanelContent,
      reviewPanelOpen,
      useCommentsDrawer,
    ],
  );

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
      if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) {
        setSidebarOpen(false);
      }
    },
    [editor],
  );

  const wordCount = useMemo(() => countWords(markdown), [markdown]);
  const characterCount = markdown.length;
  const sourceLockedByCollab = Boolean(collabSession) && presencePeers.length > 0;

  const handleConflictKeepLocal = useCallback(() => {
    setResolvingConflict(true);
    void resolveDocsConflictKeepLocal(saveNow)
      .then(() => {
        setConflictOpen(false);
        reportDocsSyncConflicts([]);
      })
      .finally(() => setResolvingConflict(false));
  }, [saveNow]);

  const handleConflictUseServer = useCallback(() => {
    const ydoc = collabSession?.ydoc;
    if (!ydoc || !urls?.yjsUrl) return;
    setResolvingConflict(true);
    void resolveDocsConflictUseServer(ydoc, urls.yjsUrl, urls.authToken)
      .then(() => {
        setConflictOpen(false);
        if (editor) {
          setMarkdown(getAcceptedTextEditorContent(editor, editorFormat));
        }
      })
      .finally(() => setResolvingConflict(false));
  }, [collabSession?.ydoc, editor, editorFormat, urls?.authToken, urls?.yjsUrl]);

  useEffect(() => {
    if (!sourceLockedByCollab || !viewSource) return;
    setViewSource(false);
    setSourceClosedDialogOpen(true);
  }, [sourceLockedByCollab, viewSource]);

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
              titleSize="sm"
              sidebarOpen={sidebarOpen}
              onToggleSidebar={() => setSidebarOpen((open) => !open)}
              actions={
                <DocsHeaderActions
                  leading={
                    <>
                      {showPendingSyncIndicator ? (
                        <span
                          className="docs-workspace__pending-sync"
                          role="status"
                          aria-live="polite"
                          aria-label={pendingSyncLabel}
                        >
                          <LoadingSpinner size="sm" />
                        </span>
                      ) : null}
                      {collabSession ? (
                        <DocsCollabPresence
                          localUser={{
                            displayName: collabSession.user.name,
                          }}
                          peers={presencePeers}
                          connectingPeers={connectingPeers}
                          warningPeers={warningPeers}
                          className="mr-1"
                        />
                      ) : null}
                    </>
                  }
                  actions={[
                    {
                      id: "view-source",
                      label: sourceLockedByCollab
                        ? "Source view is disabled while collaborating"
                        : reviewPanelOpen
                          ? "Source view is disabled while review is open"
                          : viewSource
                            ? labels.hideSource
                            : labels.viewSource,
                      icon: <Code2 />,
                      active: viewSource,
                      disabled: !editor || sourceLockedByCollab || reviewPanelOpen,
                      className: cn(viewSource && "docs-workspace__source-toggle--active"),
                      onClick: () => setViewSource((on) => !on),
                    },
                    {
                      id: "print",
                      label: labels.print,
                      icon: <Printer />,
                      disabled: !editor,
                      onClick: () => printTextEditorSheet(editor),
                    },
                    ...(showShare && onShare
                      ? [
                          {
                            id: "share",
                            label: shareLabel ?? labels.share,
                            icon: <Share2 />,
                            className: "docs-workspace__share-button",
                            onClick: onShare,
                          },
                        ]
                      : []),
                    {
                      id: "review",
                      label: viewSource
                        ? "Review is disabled in source view"
                        : reviewPanelOpen
                          ? labels.reviewToggleHide
                          : reviewItemCount > 0
                            ? `${labels.reviewToggleShow} (${reviewItemCount})`
                            : labels.reviewToggleShow,
                      icon: <MessageSquare />,
                      active: reviewPanelOpen,
                      disabled: viewSource,
                      className: "docs-workspace__review-toggle",
                      "data-count": reviewItemCount > 0 ? reviewItemCount : undefined,
                      onClick: handleToggleReview,
                    },
                  ]}
                />
              }
            />
          }
          main={
            <div className="docs-workspace__editor">
              {collabSession ? (
                <DocsCollabEditor
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
                  showSuggestControls={permissions.editable}
                />
              ) : null}
              <DocsEditorStatsFooter
                wordCount={wordCount}
                characterCount={characterCount}
                statsWordsLabel={labels.statsWords}
                statsCharactersLabel={labels.statsCharacters}
                status={docStatus ? <DocsDocStatus status={docStatus} /> : null}
              />
            </div>
          }
        />
        {reviewDrawer}
        <DocsConflictDialog
          open={conflictOpen}
          documentTitle={resolvedDocumentTitle}
          busy={resolvingConflict}
          labels={labels}
          onKeepLocal={handleConflictKeepLocal}
          onUseServer={handleConflictUseServer}
          onOpenChange={setConflictOpen}
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
