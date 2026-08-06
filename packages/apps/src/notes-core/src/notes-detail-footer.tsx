import { BookOpen, CalendarDays } from "lucide-react";
import { Tag } from "@/tag/src/tag";
import { WorkspaceChromeFooter } from "@/workspace-shell/src/workspace-chrome-footer";

export type NotesDetailFooterProps = {
  notebook?: string;
  lastEdited?: string;
  editedLabel?: string;
};

/** Pinned notes detail footer: notebook + last-edited meta chips. */
export function NotesDetailFooter({
  notebook,
  lastEdited,
  editedLabel = "Edited ",
}: NotesDetailFooterProps) {
  const hasNotebook = notebook != null && notebook !== "";
  const hasEdited = lastEdited != null && lastEdited !== "";
  if (!hasNotebook && !hasEdited) return null;

  return (
    <WorkspaceChromeFooter className="notes-detail-footer">
      {hasNotebook ? (
        <div className="notes-detail-footer__meta-tag notes-detail-footer__meta-tag--notebook">
          <Tag label={notebook} icon={<BookOpen className="size-3.5 opacity-70" />} />
        </div>
      ) : null}
      {hasEdited ? (
        <div className="notes-detail-footer__meta-tag notes-detail-footer__meta-tag--edited">
          <Tag
            label={`${editedLabel}${lastEdited}`}
            icon={<CalendarDays className="size-3.5 opacity-70" />}
          />
        </div>
      ) : null}
    </WorkspaceChromeFooter>
  );
}
