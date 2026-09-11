import { MessageSquarePlus } from "lucide-react";
import type { DocsUILabels } from "@/docs-core/src/docs-labels";
import { IconButton } from "@/button/src/button";

export type DocsCollabCommentControlProps = {
  labels: Pick<
    DocsUILabels,
    | "commentsAddFromSelection"
    | "commentsAddFromSelectionDisabledNoSelection"
    | "commentsAddFromSelectionDisabledViewSource"
    | "commentsAddFromSelectionDisabledReadOnly"
  >;
  canAddFromSelection: boolean;
  commentsDisabled?: boolean;
  /** Prefer an explicit title when comments are disabled (view-source vs share rights). */
  commentsDisabledTitle?: string;
  onAddCommentFromSelection: () => void;
  className?: string;
};

/** Format-bar control to start a comment on the current editor selection. */
export function DocsCollabCommentControl({
  labels,
  canAddFromSelection,
  commentsDisabled = false,
  commentsDisabledTitle,
  onAddCommentFromSelection,
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
      size="sm"
      variant="outline"
      className={className}
    />
  );
}
