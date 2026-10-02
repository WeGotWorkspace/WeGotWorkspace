import type { Editor } from "@tiptap/react";
import { Code2, Printer, Share } from "lucide-react";
import type { DocsUILabels } from "@/docs-core/src/docs-labels";
import type { DocsHeaderAction } from "@/docs-core/src/docs-header-actions";
import { printTextEditorSheet } from "@/text-editor-core/src/text-editor-print";
import { cn } from "@/lib/utils";

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
};

function sourceToggleLabel(input: DocsCollabHeaderActionsInput): string {
  if (input.sourceLockedByCollab) return SOURCE_LOCKED_BY_COLLAB;
  if (input.reviewPanelOpen) return SOURCE_LOCKED_BY_REVIEW;
  return input.viewSource ? input.labels.hideSource : input.labels.viewSource;
}

/** Docs header actions in display order, each carrying its own disabled reason. */
export function docsCollabHeaderActions(input: DocsCollabHeaderActionsInput): DocsHeaderAction[] {
  const { labels, editor, viewSource, sourceLockedByCollab, reviewPanelOpen, share } = input;
  return [
    {
      id: "print",
      label: labels.print,
      icon: <Printer />,
      disabled: !editor || viewSource,
      onClick: () => printTextEditorSheet(editor),
    },
    ...(share
      ? [
          {
            id: "share",
            label: share.label,
            icon: <Share />,
            className: "docs-workspace__share-button",
            onClick: share.onClick,
          },
        ]
      : []),
    {
      id: "view-source",
      label: sourceToggleLabel(input),
      icon: <Code2 />,
      active: viewSource,
      disabled: !editor || sourceLockedByCollab || reviewPanelOpen,
      className: cn(viewSource && "docs-workspace__source-toggle--active"),
      onClick: input.onToggleViewSource,
    },
  ];
}
