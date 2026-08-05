import { useEffect, useMemo, useRef } from "react";
import type { Editor } from "@tiptap/react";
import type { DocsUILabels } from "@/docs-core/src/docs-labels";
import { escapeCommentIdForSelector } from "@/text-editor-core/src/text-editor-comment-commands";
import { escapeTrackChangeIdForSelector } from "@/text-editor-core/src/text-editor-track-changes";
import type { DocsCommentThread } from "../docs-comments-types";
import { DocsCommentsThreadCard } from "../docs-comments/docs-comments-thread-card";
import { mergeDraftThreadWithOpenThreads } from "../docs-comments/docs-comments-utils";
import { DocsCollabSidebarPanel } from "../docs-collab-card";
import type { DocsSuggestionWithThread } from "../docs-suggestions-types";
import { DocsSuggestionCard } from "../docs-suggestions/docs-suggestion-card";
import { sortReviewItemsByDocumentOrder } from "./docs-collab-review-utils";
import "./docs-collab-review-panel.css";

export type DocsCollabReviewPanelProps = {
  editor: Editor | null;
  onCloseMobile: () => void;
  /** Show header close control (mobile drawer); desktop relies on main header toggle. */
  showCloseButton?: boolean;
  labels: DocsUILabels;
  threads: DocsCommentThread[];
  draftThread?: DocsCommentThread | null;
  suggestions: DocsSuggestionWithThread[];
  currentUserId: string;
  activeThreadId: string | null;
  activeChangeId: string | null;
  canMutateComments?: boolean;
  canReviewSuggestions?: boolean;
  onSelectThread: (threadId: string) => void;
  onAddReply: (threadId: string, body: string) => void;
  onToggleReaction: (threadId: string, emoji: string) => void;
  onResolveThread: (threadId: string) => void;
  onCancelDraft?: () => void;
  onSelectSuggestion: (changeId: string) => void;
  onAcceptSuggestion: (changeId: string) => void;
  onRejectSuggestion: (changeId: string) => void;
  onAddSuggestionReply: (changeId: string, body: string) => void;
  onToggleSuggestionReaction: (changeId: string, emoji: string) => void;
};

export function DocsCollabReviewPanel({
  editor,
  onCloseMobile,
  showCloseButton = false,
  labels,
  threads,
  draftThread = null,
  suggestions,
  currentUserId,
  activeThreadId,
  activeChangeId,
  canMutateComments = true,
  canReviewSuggestions = true,
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
}: DocsCollabReviewPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const displayThreads = useMemo(
    () => mergeDraftThreadWithOpenThreads(threads, draftThread),
    [draftThread, threads],
  );

  const reviewItems = useMemo(
    () => sortReviewItemsByDocumentOrder(editor, displayThreads, suggestions),
    [displayThreads, editor, suggestions],
  );

  const isEmpty = reviewItems.length === 0;

  const countLabel =
    reviewItems.length === 1 ? labels.reviewCountOne : labels.reviewCountMany(reviewItems.length);

  useEffect(() => {
    if (!scrollRef.current) return;
    if (activeChangeId) {
      const card = scrollRef.current.querySelector(
        `[data-change-id="${escapeTrackChangeIdForSelector(activeChangeId)}"]`,
      );
      card?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
      return;
    }
    if (!activeThreadId) return;
    const card = scrollRef.current.querySelector(
      `[data-thread-id="${escapeCommentIdForSelector(activeThreadId)}"]`,
    );
    card?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [activeChangeId, activeThreadId]);

  return (
    <DocsCollabSidebarPanel
      className="docs-collab-review-panel"
      ariaLabel={labels.reviewSidebarTitle}
      title={labels.reviewSidebarTitle}
      titleSize="default"
      countLabel={countLabel}
      closeLabel={labels.reviewCloseSidebar}
      onClose={onCloseMobile}
      showCloseButton={showCloseButton}
      scrollRef={scrollRef}
      empty={isEmpty}
      emptyLabel={labels.reviewEmpty}
      listClassName="docs-collab-review-panel__list"
    >
      {reviewItems.map((item) => {
        if (item.type === "suggestion") {
          const { suggestion } = item;
          return (
            <DocsSuggestionCard
              key={`suggestion-${suggestion.changeId}`}
              suggestion={suggestion}
              labels={labels}
              currentUserId={currentUserId}
              active={activeChangeId === suggestion.changeId}
              onSelect={() => onSelectSuggestion(suggestion.changeId)}
              onAccept={() => {
                if (canReviewSuggestions) onAcceptSuggestion(suggestion.changeId);
              }}
              onReject={() => {
                if (canReviewSuggestions) onRejectSuggestion(suggestion.changeId);
              }}
              onAddReply={(body) => {
                if (canMutateComments) onAddSuggestionReply(suggestion.changeId, body);
              }}
              onToggleReaction={(emoji) => {
                if (canMutateComments) onToggleSuggestionReaction(suggestion.changeId, emoji);
              }}
            />
          );
        }

        const { thread } = item;
        const isDraft = thread.messages.length === 0;
        return (
          <DocsCommentsThreadCard
            key={`comment-${thread.id}`}
            thread={thread}
            labels={labels}
            currentUserId={currentUserId}
            active={activeThreadId === thread.id}
            canMutate={canMutateComments}
            onSelect={() => onSelectThread(thread.id)}
            onAddReply={(body) => onAddReply(thread.id, body)}
            onToggleReaction={(emoji) => onToggleReaction(thread.id, emoji)}
            onResolve={() => onResolveThread(thread.id)}
            onCancelDraft={isDraft ? onCancelDraft : undefined}
          />
        );
      })}
    </DocsCollabSidebarPanel>
  );
}
