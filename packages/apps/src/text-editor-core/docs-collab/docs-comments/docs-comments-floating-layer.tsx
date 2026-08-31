import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { DocsUILabels } from "@/docs-core/src/docs-labels";
import { escapeCommentIdForSelector } from "@/text-editor-core/src/text-editor-comment-commands";
import type { DocsCommentThread } from "../docs-comments-types";
import { useDocsCollabFloatingLayerLayout } from "../docs-collab-card";
import { DocsCommentsThreadCard } from "./docs-comments-thread-card";
import { mergeDraftThreadWithOpenThreads } from "./docs-comments-utils";
import {
  observeCommentMarkVisibility,
  resolveCommentVisibilityModeAsync,
  sortThreadsByDocumentOrder,
  syncCommentMarkVisibility,
  syncCommentViewTimelineStyles,
  type DocsCommentVisibilityMode,
} from "./docs-comments-mark-visibility";

import "./docs-comments-floating-layer.css";

export type DocsCommentsFloatingLayerProps = {
  editor: Editor | null;
  visible: boolean;
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

const SCROLL_ANCHOR_VIEWPORT_OFFSET_FRACTION = 1 / 3;

export function DocsCommentsFloatingLayer({
  editor,
  visible,
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
}: DocsCommentsFloatingLayerProps) {
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const [visibilityMode, setVisibilityMode] = useState<DocsCommentVisibilityMode>("static");
  const showLayer = visible || draftThread != null;
  const { layerRef, containerLayout } = useDocsCollabFloatingLayerLayout({
    editor,
    visible: showLayer,
  });

  const registerCardRef = useCallback((threadId: string, node: HTMLDivElement | null) => {
    if (node) {
      cardRefs.current.set(threadId, node);
      return;
    }
    cardRefs.current.delete(threadId);
  }, []);

  const displayThreads = useMemo(
    () => mergeDraftThreadWithOpenThreads(threads, draftThread),
    [draftThread, threads],
  );

  const orderedThreads = useMemo(() => {
    if (!editor) return displayThreads;
    return sortThreadsByDocumentOrder(editor, displayThreads);
  }, [displayThreads, editor]);

  const markedThreadIds = useMemo(
    () => orderedThreads.filter((thread) => thread.messages.length > 0).map((thread) => thread.id),
    [orderedThreads],
  );

  useEffect(() => {
    if (!editor || !showLayer) return;

    const syncTimelines = () => {
      syncCommentViewTimelineStyles(editor, markedThreadIds);
    };

    syncTimelines();
    editor.on("transaction", syncTimelines);
    editor.on("update", syncTimelines);

    return () => {
      editor.off("transaction", syncTimelines);
      editor.off("update", syncTimelines);
      syncCommentViewTimelineStyles(editor, []);
    };
  }, [editor, markedThreadIds, showLayer]);

  useEffect(() => {
    if (!editor || !showLayer) return;

    let cancelled = false;
    void resolveCommentVisibilityModeAsync().then((mode) => {
      if (!cancelled) setVisibilityMode(mode);
    });

    return () => {
      cancelled = true;
    };
  }, [editor, markedThreadIds, showLayer]);

  useEffect(() => {
    if (!editor || !showLayer || visibilityMode !== "observer") return;

    const getCardElement = (threadId: string) => cardRefs.current.get(threadId);
    const visibilityObserver = observeCommentMarkVisibility(
      editor,
      getCardElement,
      markedThreadIds,
    );
    const resyncVisibility = () => visibilityObserver.resync();

    resyncVisibility();
    editor.on("transaction", resyncVisibility);
    editor.on("update", resyncVisibility);

    return () => {
      editor.off("transaction", resyncVisibility);
      editor.off("update", resyncVisibility);
      visibilityObserver.disconnect();
    };
  }, [editor, markedThreadIds, showLayer, visibilityMode]);

  useEffect(() => {
    if (!editor || !showLayer || visibilityMode !== "static") return;

    const getCardElement = (threadId: string) => cardRefs.current.get(threadId);
    const syncVisibility = () => syncCommentMarkVisibility(editor, getCardElement, markedThreadIds);

    syncVisibility();
    editor.on("transaction", syncVisibility);
    editor.on("update", syncVisibility);

    const scrollport = editor.view.dom.closest(".text-editor-sheet--fill");
    scrollport?.addEventListener("scroll", syncVisibility, { passive: true });

    return () => {
      editor.off("transaction", syncVisibility);
      editor.off("update", syncVisibility);
      scrollport?.removeEventListener("scroll", syncVisibility);
    };
  }, [editor, markedThreadIds, showLayer, visibilityMode]);

  useEffect(() => {
    if (!showLayer || !activeThreadId || !editor) return;

    const mark = editor.view.dom.querySelector(
      `[data-comment-id="${escapeCommentIdForSelector(activeThreadId)}"]`,
    );
    if (mark) {
      mark.scrollIntoView({ block: "nearest", behavior: "smooth" });
      return;
    }

    const thread = orderedThreads.find((item) => item.id === activeThreadId);
    if (thread && typeof thread.anchorFrom === "number") {
      try {
        const coords = editor.view.coordsAtPos(thread.anchorFrom);
        const scrollContainer = editor.view.dom.closest(
          ".text-editor-sheet__surface",
        ) as HTMLElement | null;
        if (scrollContainer) {
          const containerRect = scrollContainer.getBoundingClientRect();
          const targetScrollTop =
            coords.top -
            containerRect.top +
            scrollContainer.scrollTop -
            containerRect.height * SCROLL_ANCHOR_VIEWPORT_OFFSET_FRACTION;
          scrollContainer.scrollTo({ top: Math.max(0, targetScrollTop), behavior: "smooth" });
        }
      } catch {
        // Anchor position no longer valid.
      }
    }
  }, [activeThreadId, editor, orderedThreads, showLayer]);

  if (!editor || orderedThreads.length === 0 || !showLayer || containerLayout == null) return null;

  return (
    <div
      ref={layerRef}
      className="docs-comments-floating-layer"
      data-visible="true"
      data-visibility-mode={visibilityMode}
      role="region"
      aria-label={labels.commentsSidebarTitle}
      style={{
        top: `${containerLayout.top}px`,
        left: `${containerLayout.left}px`,
        maxHeight: `${containerLayout.maxHeight}px`,
      }}
    >
      <div className="docs-comments-floating-layer__stack">
        {orderedThreads.map((thread) => {
          const isDraft = thread.messages.length === 0;
          const isActive = activeThreadId === thread.id;
          const cardMaxHeight = Math.min(384, Math.max(containerLayout.maxHeight - 16, 120));

          return (
            <div
              key={thread.id}
              ref={(node) => registerCardRef(thread.id, node)}
              className="docs-comments-floating-layer__card"
              data-thread-id={thread.id}
              data-draft={isDraft ? "true" : "false"}
              data-in-view={isDraft ? "true" : undefined}
              data-active={isActive ? "true" : "false"}
              style={{
                ["--docs-comments-thread-card-max-height" as string]: `${cardMaxHeight}px`,
              }}
            >
              <DocsCommentsThreadCard
                thread={thread}
                labels={labels}
                currentUserId={currentUserId}
                active={isActive}
                onSelect={() => onSelectThread(thread.id)}
                onAddReply={(body) => onAddReply(thread.id, body)}
                onToggleReaction={(emoji) => onToggleReaction(thread.id, emoji)}
                onResolve={() => onResolveThread(thread.id)}
                onCancelDraft={isDraft ? onCancelDraft : undefined}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
