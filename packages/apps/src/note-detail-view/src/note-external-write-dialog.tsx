import type { NoteBodyLabels } from "@/note-detail-view/src/note-body-labels";
import { CollabExternalWriteDialog } from "@/collab-ui/collab-external-write-dialog";

export type NoteExternalWriteDialogProps = {
  open: boolean;
  noteTitle: string;
  busy?: boolean;
  /** Set once the outside version replaced the local note in this question. */
  keepLocalDisabled?: boolean;
  labels: NoteBodyLabels;
  onKeepLocal: () => void;
  onUseOutside: () => void;
};

/** The shared question (`CollabExternalWriteDialog`) with the Notes words and surface. */
export function NoteExternalWriteDialog({
  noteTitle,
  labels,
  ...props
}: NoteExternalWriteDialogProps) {
  return (
    <CollabExternalWriteDialog
      {...props}
      name={noteTitle}
      className="notes-dialog-surface"
      labels={{
        title: labels.externalWriteTitle,
        description: labels.externalWriteDescription,
        keepMine: labels.externalWriteKeepMine,
        useOutside: labels.externalWriteUseOutside,
      }}
    />
  );
}
