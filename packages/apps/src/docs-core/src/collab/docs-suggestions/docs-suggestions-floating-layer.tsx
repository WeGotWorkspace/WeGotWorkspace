import { useEffect } from "react";
import type { Editor } from "@tiptap/react";
import type { DocsUILabels } from "@/docs-core/src/docs-labels";
import { escapeTrackChangeIdForSelector } from "@/text-editor-core/src/text-editor-track-changes";
import type { DocsSuggestionWithThread } from "@/text-editor-core/docs-collab/docs-suggestions-types";
import { useDocsCollabFloatingLayerLayout } from "../docs-collab-card";
import { DocsSuggestionCard } from "./docs-suggestion-card";
import "./docs-suggestions-floating-layer.css";

export type DocsSuggestionsFloatingLayerProps = {
  editor: Editor | null;
  visible: boolean;
  labels: DocsUILabels;
  suggestions: DocsSuggestionWithThread[];
  currentUserId: string;
  activeChangeId: string | null;
  onSelectSuggestion: (changeId: string) => void;
  onAcceptSuggestion: (changeId: string) => void;
  onRejectSuggestion: (changeId: string) => void;
  onAddReply: (changeId: string, body: string) => void;
  onToggleReaction: (changeId: string, emoji: string) => void;
};

const SCROLL_ANCHOR_VIEWPORT_OFFSET_FRACTION = 1 / 3;

export function DocsSuggestionsFloatingLayer({
  editor,
  visible,
  labels,
  suggestions,
  currentUserId,
  activeChangeId,
  onSelectSuggestion,
  onAcceptSuggestion,
  onRejectSuggestion,
  onAddReply,
  onToggleReaction,
}: DocsSuggestionsFloatingLayerProps) {
  const { layerRef, containerLayout } = useDocsCollabFloatingLayerLayout({ editor, visible });

  useEffect(() => {
    if (!visible || !activeChangeId || !editor) return;

    const mark = editor.view.dom.querySelector(
      `[data-change-id="${escapeTrackChangeIdForSelector(activeChangeId)}"]`,
    );
    if (mark) {
      mark.scrollIntoView({ block: "nearest", behavior: "smooth" });
      return;
    }

    const suggestion = suggestions.find((item) => item.changeId === activeChangeId);
    if (!suggestion) return;

    try {
      const coords = editor.view.coordsAtPos(suggestion.from);
      const scrollContainer = editor.view.dom.closest(
        ".text-editor-sheet__surface",
      ) as HTMLElement | null;
      if (!scrollContainer) return;
      const containerRect = scrollContainer.getBoundingClientRect();
      const targetScrollTop =
        coords.top -
        containerRect.top +
        scrollContainer.scrollTop -
        containerRect.height * SCROLL_ANCHOR_VIEWPORT_OFFSET_FRACTION;
      scrollContainer.scrollTo({ top: Math.max(0, targetScrollTop), behavior: "smooth" });
    } catch {
      // Anchor position no longer valid.
    }
  }, [activeChangeId, editor, suggestions, visible]);

  if (!editor || suggestions.length === 0 || !visible || containerLayout == null) return null;

  return (
    <div
      ref={layerRef}
      className="docs-suggestions-floating-layer"
      data-visible="true"
      aria-label={labels.suggestionsSidebarTitle}
      style={{
        top: `${containerLayout.top}px`,
        left: `${containerLayout.left}px`,
        maxHeight: `${containerLayout.maxHeight}px`,
      }}
    >
      <div className="docs-suggestions-floating-layer__stack">
        {suggestions.map((suggestion) => {
          const isActive = activeChangeId === suggestion.changeId;
          const cardMaxHeight = Math.min(384, Math.max(containerLayout.maxHeight - 16, 120));

          return (
            <div
              key={suggestion.changeId}
              className="docs-suggestions-floating-layer__card"
              data-change-id={suggestion.changeId}
              data-active={isActive ? "true" : "false"}
              style={{
                ["--docs-suggestion-card-max-height" as string]: `${cardMaxHeight}px`,
              }}
            >
              <DocsSuggestionCard
                suggestion={suggestion}
                labels={labels}
                currentUserId={currentUserId}
                active={isActive}
                onSelect={() => onSelectSuggestion(suggestion.changeId)}
                onAccept={() => onAcceptSuggestion(suggestion.changeId)}
                onReject={() => onRejectSuggestion(suggestion.changeId)}
                onAddReply={(body) => onAddReply(suggestion.changeId, body)}
                onToggleReaction={(emoji) => onToggleReaction(suggestion.changeId, emoji)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
