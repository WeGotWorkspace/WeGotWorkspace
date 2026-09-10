import type { ReactNode } from "react";
import { CalendarDays } from "lucide-react";
import { Tag } from "@/tag/src/tag";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import { WorkspaceChromeFooter } from "@/workspace-shell/src/workspace-chrome-footer";

export type NotesDetailFooterProps = {
  lastEdited?: string;
  /** Clarification for tooltip + aria-label (visible chip shows date only). */
  editedLabel?: string;
  /** Leading slot (e.g. collab presence), aligned left. */
  start?: ReactNode;
};

/** Pinned notes detail footer: optional presence (start) + last-edited meta (end). */
export function NotesDetailFooter({
  lastEdited,
  editedLabel = "Last edited",
  start,
}: NotesDetailFooterProps) {
  const hasEdited = lastEdited != null && lastEdited !== "" && lastEdited !== "—";
  if (!hasEdited && start == null) return null;

  return (
    <WorkspaceChromeFooter
      className="notes-detail-footer"
      end={
        hasEdited ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                className="notes-detail-footer__meta-tag notes-detail-footer__meta-tag--edited"
                aria-label={editedLabel}
              >
                <Tag
                  label={lastEdited}
                  icon={<CalendarDays className="size-3.5 opacity-70" aria-hidden />}
                />
              </div>
            </TooltipTrigger>
            <TooltipContent>{editedLabel}</TooltipContent>
          </Tooltip>
        ) : undefined
      }
    >
      {start}
    </WorkspaceChromeFooter>
  );
}
