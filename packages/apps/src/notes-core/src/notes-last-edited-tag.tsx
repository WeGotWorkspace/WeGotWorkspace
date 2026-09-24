import type { ReactNode } from "react";
import {
  detailFooterLastEditedTag,
  type DetailFooterLastEditedTagProps,
} from "@/workspace-shell/src/detail-footer-last-edited-tag";

export type NotesLastEditedTagProps = DetailFooterLastEditedTagProps;

/**
 * Last-edited meta tag for the shared `WorkspaceDetailFooter` `tags` slot.
 * Shared primitive: {@link detailFooterLastEditedTag}.
 */
export function notesLastEditedTag(props: NotesLastEditedTagProps): ReactNode {
  return detailFooterLastEditedTag(props);
}
