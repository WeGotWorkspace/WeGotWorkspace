import { MessageSquarePlus } from "lucide-react";
import type { DocsCollabCommentControlLabels } from "@/text-editor-core/docs-collab/docs-collab-labels";
import { IconButton } from "@/button/src/button";
import type { TextEditorFormatBarSize } from "@/text-editor-core/src/text-editor-format-bar-config";

export type DocsCollabCommentControlProps = {
  labels: DocsCollabCommentControlLabels;
  canAddFromSelection: boolean;
  commentsDisabled?: boolean;
  /** Prefer an explicit title when comments are disabled (view-source vs share rights). */
  commentsDisabledTitle?: string;
  onAddCommentFromSelection: () => void;
  /** Match the format bar it sits in. */
  size?: TextEditorFormatBarSize;
  className?: string;
};

/** Format-bar control to start a comment on the current editor selection. */
export function DocsCollabCommentControl({
  labels,
  canAddFromSelection,
  commentsDisabled = false,
  commentsDisabledTitle,
  onAddCommentFromSelection,
  size = "md",
  className,
}: DocsCollabCommentControlProps) {
  const disabled = commentsDisabled || !canAddFromSelection;
  const label = commentsDisabled
    ? (commentsDisabledTitle ?? labels.commentsAddFromSelectionDisabledViewSource)
    : !canAddFromSelection
      ? labels.commentsAddFromSelectionDisabledNoSelection
      : labels.commentsAddFromSelection;

  return (
    <IconButton
      label={label}
      aria-label={labels.commentsAddFromSelection}
      disabled={disabled}
      onClick={onAddCommentFromSelection}
      icon={<MessageSquarePlus aria-hidden />}
      size={size}
      variant="outline"
      className={className}
    />
  );
}
