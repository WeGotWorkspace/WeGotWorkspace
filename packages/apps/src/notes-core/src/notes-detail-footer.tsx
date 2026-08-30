import { CalendarDays } from "lucide-react";
import { Tag } from "@/tag/src/tag";
import { WorkspaceChromeFooter } from "@/workspace-shell/src/workspace-chrome-footer";

export type NotesDetailFooterProps = {
  lastEdited?: string;
  editedLabel?: string;
};

/** Pinned notes detail footer: last-edited meta chip (trailing status slot). */
export function NotesDetailFooter({
  lastEdited,
  editedLabel = "Last edited ",
}: NotesDetailFooterProps) {
  const hasEdited = lastEdited != null && lastEdited !== "" && lastEdited !== "—";
  if (!hasEdited) return null;

  return (
    <WorkspaceChromeFooter
      className="notes-detail-footer"
      end={
        <div className="notes-detail-footer__meta-tag notes-detail-footer__meta-tag--edited">
          <Tag
            label={`${editedLabel}${lastEdited}`}
            icon={<CalendarDays className="size-3.5 opacity-70" />}
          />
        </div>
      }
    />
  );
}
