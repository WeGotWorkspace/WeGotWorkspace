import { useEffect, useMemo, useRef } from "react";
import type { DocsUILabels } from "@/docs-core/src/docs-labels";
import { escapeCommentIdForSelector } from "@/text-editor-core/src/text-editor-comment-commands";
import type { DocsCommentThread } from "../docs-comments-types";
import { DocsCollabSidebarPanel } from "../docs-collab-card";
import { DocsCommentsThreadCard } from "./docs-comments-thread-card";
import { mergeDraftThreadWithOpenThreads } from "./docs-comments-utils";
import "./docs-comments-panel.css";

export type DocsCommentsPanelProps = {
  onCloseMobile: () => void;
  labels: DocsUILabels;
  threads: DocsCommentThread[];
  draftThread?: DocsCommentThread | null;
  currentUserId: string;
  activeThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  onAddReply: (threadId: string, body: string) => void;
  onToggleReaction: (threadId: string, emoji: string) => void;
  onResolveThread: (threadId: string) => void;
  onCancelDraft?: () => void;
};

export function DocsCommentsPanel({
  onCloseMobile,
  labels,
  threads,
  draftThread = null,
  currentUserId,
  activeThreadId,
  onSelectThread,
  onAddReply,
  onToggleReaction,
  onResolveThread,
  onCancelDraft,
}: DocsCommentsPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const displayThreads = useMemo(
    () => mergeDraftThreadWithOpenThreads(threads, draftThread),
    [draftThread, threads],
  );

  useEffect(() => {
    if (!activeThreadId || !scrollRef.current) return;
    const card = scrollRef.current.querySelector(
      `[data-thread-id="${escapeCommentIdForSelector(activeThreadId)}"]`,
    );
    card?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [activeThreadId]);

  return (
    <DocsCollabSidebarPanel
      className="docs-comments-panel"
      ariaLabel={labels.commentsSidebarTitle}
      title={labels.commentsSidebarTitle}
      count={displayThreads.length}
      countLabel={
        displayThreads.length === 1
          ? labels.commentsCountOne
          : labels.commentsCountMany(displayThreads.length)
      }
      closeLabel={labels.commentsCloseSidebar}
      onClose={onCloseMobile}
      showCloseButton
      scrollRef={scrollRef}
      empty={displayThreads.length === 0}
      emptyLabel={labels.commentsEmpty}
      listClassName="docs-collab-sidebar-panel__list docs-comments-panel__threads"
    >
      {displayThreads.map((thread) => {
        const isDraft = thread.messages.length === 0;
        return (
          <DocsCommentsThreadCard
            key={thread.id}
            thread={thread}
            labels={labels}
            currentUserId={currentUserId}
            active={activeThreadId === thread.id}
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

/** @deprecated Use DocsCommentsPanel */
export type DocsCommentsSidebarProps = DocsCommentsPanelProps;

/** @deprecated Use DocsCommentsPanel */
export const DocsCommentsSidebar = DocsCommentsPanel;
