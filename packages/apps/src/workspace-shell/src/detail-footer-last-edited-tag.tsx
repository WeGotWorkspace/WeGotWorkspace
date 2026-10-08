import type { ReactNode } from "react";
import { CalendarDays } from "lucide-react";
import { LoadingSpinner } from "@/loading-spinner/src/loading-spinner";
import { Tag } from "@/tag/src/tag";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import { UserPresenceDot, type UserAvatarPresence } from "@/user-avatar/src/user-avatar";
import { cn } from "@/lib/utils";

/** Landed save vs a save that has not reached the server yet. */
export type DetailFooterSaveSync = "saved" | "pending";

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
  /**
   * Presence pip beside the timestamp. Same component as the Meet sidebar:
   * green when the document is saved, amber while a save is still pending.
   */
  sync?: DetailFooterSaveSync;
};

function saveSyncPresence(sync: DetailFooterSaveSync): UserAvatarPresence {
  return sync === "saved" ? "online" : "away";
}

/**
 * Last-edited meta tag for the shared `WorkspaceDetailFooter` `tags` slot.
 * Returns `undefined` when idle with no real timestamp (so the footer can omit the end group).
 */
export function detailFooterLastEditedTag({
  lastEdited,
  editedLabel = "Last edited",
  busy = false,
  busyLabel = "Saving…",
  sync,
}: DetailFooterLastEditedTagProps): ReactNode {
  const hasEdited = lastEdited != null && lastEdited !== "" && lastEdited !== "—";
  if (!busy && !hasEdited) return undefined;

  const label = hasEdited ? lastEdited! : busyLabel;
  const ariaLabel = busy
    ? busyLabel
    : sync === "pending"
      ? busyLabel
      : sync === "saved"
        ? `${editedLabel}, saved`
        : editedLabel;
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
          data-save-sync={sync}
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
            end={sync ? <UserPresenceDot presence={saveSyncPresence(sync)} standalone /> : null}
          />
        </div>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
