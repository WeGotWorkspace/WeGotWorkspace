import { useMemo, type ReactNode } from "react";
import { SideDrawer } from "@/ui/side-drawer";
import { DOCS_COLLAB_SIDEBAR_PANEL_DRAWER_CLASS } from "@/text-editor-core/docs-collab/docs-collab-card";
import {
  DocsCollabReviewPanel,
  type DocsCollabReviewPanelProps,
} from "./docs-collab-review/docs-collab-review-panel";

export type DocsCollabReviewSurfacesInput = Omit<
  DocsCollabReviewPanelProps,
  "onCloseMobile" | "showCloseButton"
> & {
  /** False until the collab session exists — neither surface renders before that. */
  active: boolean;
  open: boolean;
  /** Narrow viewports host the panel in a drawer instead of the layout sidebar. */
  useDrawer: boolean;
  onClose: () => void;
};

export type DocsCollabReviewSurfaces = {
  /** Layout sidebar panel, or null on viewports that use the drawer. */
  sidebar: ReactNode;
  /** Mobile drawer, or null on viewports that use the sidebar. */
  drawer: ReactNode;
};

/**
 * Builds the two places the Docs review panel can live — the layout sidebar and
 * the mobile drawer — from one set of review props. Memoised per field so a
 * keystroke in the editor does not re-render the review tree.
 */
export function useDocsCollabReviewSurfaces(
  input: DocsCollabReviewSurfacesInput,
): DocsCollabReviewSurfaces {
  const {
    active,
    open,
    useDrawer,
    onClose,
    editor,
    labels,
    threads,
    draftThread,
    suggestions,
    archivedSuggestions,
    currentUserId,
    activeThreadId,
    activeChangeId,
    canMutateComments,
    canReviewSuggestions,
    onSelectThread,
    onAddReply,
    onToggleReaction,
    onResolveThread,
    onCancelDraft,
    onSelectSuggestion,
    onAcceptSuggestion,
    onRejectSuggestion,
    onAddSuggestionReply,
    onToggleSuggestionReaction,
  } = input;

  const content = useMemo(
    () => (
      <DocsCollabReviewPanel
        editor={editor}
        onCloseMobile={onClose}
        showCloseButton
        labels={labels}
        threads={threads}
        draftThread={draftThread}
        suggestions={suggestions}
        archivedSuggestions={archivedSuggestions}
        currentUserId={currentUserId}
        activeThreadId={activeThreadId}
        activeChangeId={activeChangeId}
        canMutateComments={canMutateComments}
        canReviewSuggestions={canReviewSuggestions}
        onSelectThread={onSelectThread}
        onAddReply={onAddReply}
        onToggleReaction={onToggleReaction}
        onResolveThread={onResolveThread}
        onCancelDraft={onCancelDraft}
        onSelectSuggestion={onSelectSuggestion}
        onAcceptSuggestion={onAcceptSuggestion}
        onRejectSuggestion={onRejectSuggestion}
        onAddSuggestionReply={onAddSuggestionReply}
        onToggleSuggestionReaction={onToggleSuggestionReaction}
      />
    ),
    [
      activeChangeId,
      activeThreadId,
      archivedSuggestions,
      canMutateComments,
      canReviewSuggestions,
      currentUserId,
      draftThread,
      editor,
      labels,
      onAcceptSuggestion,
      onAddReply,
      onAddSuggestionReply,
      onCancelDraft,
      onClose,
      onRejectSuggestion,
      onResolveThread,
      onSelectSuggestion,
      onSelectThread,
      onToggleReaction,
      onToggleSuggestionReaction,
      suggestions,
      threads,
    ],
  );

  const sidebar = useMemo(
    () =>
      active && !useDrawer ? (
        <div
          className="workspace-app-layout__panel docs-workspace__review-panel"
          data-open={open ? "true" : "false"}
          aria-hidden={!open}
        >
          {content}
        </div>
      ) : null,
    [active, content, open, useDrawer],
  );

  const drawer = useMemo(
    () =>
      active && useDrawer ? (
        <SideDrawer
          open={open}
          onClose={onClose}
          title={labels.reviewSidebarTitle}
          className={`${DOCS_COLLAB_SIDEBAR_PANEL_DRAWER_CLASS} docs-collab-review-panel-drawer`}
          contentClassName="docs-collab-review-panel-drawer__body"
        >
          {content}
        </SideDrawer>
      ) : null,
    [active, content, labels.reviewSidebarTitle, onClose, open, useDrawer],
  );

  return { sidebar, drawer };
}
