import type { ReactNode } from "react";
import { CalendarDays } from "lucide-react";
import { LoadingSpinner } from "@/loading-spinner/src/loading-spinner";
import { Tag } from "@/tag/src/tag";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import { cn } from "@/lib/utils";

export type DetailFooterLastEditedTagProps = {
  lastEdited?: string;
  /** Clarification for tooltip + aria-label (visible chip shows date only). */
  editedLabel?: string;
  /**
   * When true, swap the calendar icon for a spinner (sync/save in progress).
   * Renders even when `lastEdited` is empty so pending state stays visible.
   */
  busy?: boolean;
  /** Accessible label while `busy` (English, e.g. "Unsaved changes"). */
  busyLabel?: string;
};

/**
 * Last-edited meta tag for the shared `WorkspaceDetailFooter` `tags` slot.
 * Returns `undefined` when idle with no real timestamp (so the footer can omit the end group).
 */
export function detailFooterLastEditedTag({
  lastEdited,
  editedLabel = "Last edited",
  busy = false,
  busyLabel = "Saving…",
}: DetailFooterLastEditedTagProps): ReactNode {
  const hasEdited = lastEdited != null && lastEdited !== "" && lastEdited !== "—";
  if (!busy && !hasEdited) return undefined;

  const label = hasEdited ? lastEdited! : busyLabel;
  const ariaLabel = busy ? busyLabel : editedLabel;
  const tooltip = busy ? busyLabel : editedLabel;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "workspace-detail-footer__meta-tag workspace-detail-footer__meta-tag--edited",
            busy && "workspace-detail-footer__meta-tag--busy",
          )}
          aria-label={ariaLabel}
          aria-busy={busy || undefined}
          role={busy ? "status" : undefined}
        >
          <Tag
            label={label}
            icon={
              busy ? (
                <LoadingSpinner size="sm" className="size-3.5" />
              ) : (
                <CalendarDays className="size-3.5 opacity-70" aria-hidden />
              )
            }
          />
        </div>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
