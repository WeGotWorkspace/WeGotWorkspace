import type { ReactNode } from "react";

/**
 * The line above a detail title (the notebook in Notes, the address book in
 * Contacts). Renders nothing when empty. Styled by `note-detail-view.css`.
 */
export function NoteDetailEyebrow({ children }: { children?: ReactNode }) {
  return children ? <div className="note-detail-view__eyebrow">{children}</div> : null;
}
