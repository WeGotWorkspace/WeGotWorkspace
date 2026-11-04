import type { Editor } from "@tiptap/react";
import { Printer, Users } from "lucide-react";
import type { DocsUILabels } from "@/docs-core/src/docs-labels";
import type { DocsHeaderAction } from "@/docs-core/src/docs-header-actions";
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
};

function sourceToggleLabel(input: DocsCollabHeaderActionsInput): string {
  if (input.sourceLockedByCollab) return SOURCE_LOCKED_BY_COLLAB;
  if (input.reviewPanelOpen) return SOURCE_LOCKED_BY_REVIEW;
  return input.viewSource ? input.labels.hideSource : input.labels.viewSource;
}

/** Docs header actions in display order, each carrying its own disabled reason. */
export function docsCollabHeaderActions(input: DocsCollabHeaderActionsInput): DocsHeaderAction[] {
  const { labels, editor, viewSource, share } = input;
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
            icon: <Users />,
            showLabel: true,
            className: "docs-workspace__share-button",
            onClick: share.onClick,
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
