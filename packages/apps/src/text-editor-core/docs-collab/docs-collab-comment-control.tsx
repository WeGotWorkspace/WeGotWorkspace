import { MessageSquarePlus } from "lucide-react";
import type { DocsUILabels } from "@/docs-core/src/docs-labels";
import { cn } from "@/lib/utils";

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
  const title = commentsDisabled
    ? (commentsDisabledTitle ?? labels.commentsAddFromSelectionDisabledViewSource)
    : !canAddFromSelection
      ? labels.commentsAddFromSelectionDisabledNoSelection
      : labels.commentsAddFromSelection;

  return (
    <button
      type="button"
      title={title}
      aria-label={labels.commentsAddFromSelection}
      disabled={disabled}
      onClick={onAddCommentFromSelection}
      className={cn("text-editor-format-bar__btn", className)}
    >
      <span className="text-editor-format-bar__btn-icon">
        <MessageSquarePlus aria-hidden />
      </span>
    </button>
  );
}
