import type { Editor } from "@tiptap/react";
import { MessageSquare, Printer, Users } from "lucide-react";
import type { DocsUILabels } from "@/docs-core/src/docs-labels";
import type { DocsHeaderAction } from "@/docs-core/src/docs-header-actions";
import { docsDownloadHeaderAction } from "@/docs-core/src/docs-download-action";
import type { DocsDownloadState } from "@/docs-core/src/use-docs-download";
import { printTextEditorSheet } from "@/text-editor-core/src/text-editor-print";

const SOURCE_LOCKED_BY_COLLAB = "Source view is disabled while collaborating";
const SOURCE_LOCKED_BY_REVIEW = "Source view is disabled while review is open";

export type DocsCollabHeaderActionsInput = {
  labels: DocsUILabels;
  editor: Editor | null;
  viewSource: boolean;
  onToggleViewSource: () => void;
  /** Another editor is in the room, so the single-editor source view is off limits. */
  sourceLockedByCollab: boolean;
  reviewPanelOpen: boolean;
  /** Omitted when the shell does not offer sharing for this document. */
  share?: { label: string; onClick: () => void };
  /** Omitted when the shell offers no downloads (for example a snapshot preview). */
  download?: DocsDownloadState;
  /** The review panel toggle at the end, with the open thread and suggestion count. */
  review?: { itemCount: number; onToggle: () => void };
};

function reviewToggleLabel(input: DocsCollabHeaderActionsInput, itemCount: number): string {
  const { labels } = input;
  if (input.viewSource) return "Review is disabled in source view";
  if (input.reviewPanelOpen) return labels.reviewToggleHide;
  return itemCount > 0 ? `${labels.reviewToggleShow} (${itemCount})` : labels.reviewToggleShow;
}

function sourceToggleLabel(input: DocsCollabHeaderActionsInput): string {
  if (input.sourceLockedByCollab) return SOURCE_LOCKED_BY_COLLAB;
  if (input.reviewPanelOpen) return SOURCE_LOCKED_BY_REVIEW;
  return input.viewSource ? input.labels.hideSource : input.labels.viewSource;
}

/** Docs header actions in display order, each carrying its own disabled reason. */
export function docsCollabHeaderActions(input: DocsCollabHeaderActionsInput): DocsHeaderAction[] {
  const { labels, editor, viewSource, share, download, review } = input;
  return [
    {
      id: "print",
      label: labels.print,
      icon: <Printer />,
      disabled: !editor || viewSource,
      onClick: () => printTextEditorSheet(editor),
    },
    ...(download
      ? [docsDownloadHeaderAction({ labels, download, disabled: !editor || viewSource })]
      : []),
    ...(share
      ? [
          {
            id: "share",
            label: share.label,
            icon: <Users />,
            showLabel: true,
            className: "docs-workspace__share-button",
            onClick: share.onClick,
          },
        ]
      : []),
    ...(review
      ? [
          {
            id: "review",
            placement: "end" as const,
            label: reviewToggleLabel(input, review.itemCount),
            icon: <MessageSquare />,
            active: input.reviewPanelOpen,
            disabled: viewSource,
            className: "docs-workspace__review-toggle",
            "data-count": review.itemCount > 0 ? review.itemCount : undefined,
            onClick: review.onToggle,
          },
        ]
      : []),
  ];
}

/** Footer source switch: same disabled reasons the header button used to carry. */
export function docsCollabSourceToggle(input: DocsCollabHeaderActionsInput) {
  return {
    checked: input.viewSource,
    disabled: !input.editor || input.sourceLockedByCollab || input.reviewPanelOpen,
    label: input.labels.sourceSwitch,
    ariaLabel: sourceToggleLabel(input),
    onToggle: input.onToggleViewSource,
  };
}
