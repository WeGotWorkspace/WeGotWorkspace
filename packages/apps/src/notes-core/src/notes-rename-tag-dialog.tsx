import { useId, useState, type ReactElement } from "react";
import { Button } from "@/button/src/button";
import { isValidNewTag, normalizeTag } from "@/notes-core/src/note-tag";
import type { NotesUILabels } from "@/notes-core/src/notes-labels";
import { FieldLabelRow } from "@/ui/field-label-row";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { Input } from "@/ui/input";
import { NO_AUTOFILL } from "@/ui/no-autofill";

const TAG_NAME_INPUT_ID = "notes-rename-tag-name";

export type NotesRenameTagDialogProps = {
  open: boolean;
  tag: string;
  /** Existing tags, lowercased — used only for the merge hint. */
  existingTags: readonly string[];
  labels: Pick<
    NotesUILabels,
    | "renameTagTitle"
    | "renameTagDescription"
    | "renameTagNameLabel"
    | "renameTagConfirm"
    | "dialogCancel"
    | "tagCharsetHint"
    | "renameTagMergeHint"
  >;
  onClose: () => void;
  onRename: (next: string) => void;
};

export function NotesRenameTagDialog({
  open,
  tag,
  existingTags,
  labels,
  onClose,
  onRename,
}: NotesRenameTagDialogProps): ReactElement {
  const hintId = useId();
  // The draft starts over from the tag on each open.
  const session = open ? tag : null;
  const [draftSession, setDraftSession] = useState(session);
  const [draft, setDraft] = useState(tag);
  if (session !== draftSession) {
    setDraftSession(session);
    if (session !== null) setDraft(tag);
  }

  const normalizedDraft = normalizeTag(draft);
  const unchanged = normalizedDraft === normalizeTag(tag);
  const valid = isValidNewTag(draft);
  const merges =
    valid &&
    !unchanged &&
    existingTags.some((existing) => normalizeTag(existing) === normalizedDraft);
  const hint = !valid
    ? labels.tagCharsetHint
    : merges
      ? labels.renameTagMergeHint(normalizedDraft)
      : null;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="notes-dialog-surface">
        <DialogHeader>
          <DialogTitle>{labels.renameTagTitle}</DialogTitle>
          <DialogDescription>{labels.renameTagDescription}</DialogDescription>
        </DialogHeader>
        <FieldLabelRow
          layout="inline"
          fill
          label={labels.renameTagNameLabel}
          htmlFor={TAG_NAME_INPUT_ID}
          description={
            hint ? (
              <span id={hintId} role="status">
                {hint}
              </span>
            ) : undefined
          }
        >
          <Input
            id={TAG_NAME_INPUT_ID}
            value={draft}
            {...NO_AUTOFILL}
            aria-invalid={valid ? undefined : true}
            aria-describedby={hint ? hintId : undefined}
            onChange={(event) => setDraft(event.target.value)}
          />
        </FieldLabelRow>
        <DialogFooter>
          <Button type="button" variant="outline" label={labels.dialogCancel} onClick={onClose} />
          <Button
            type="button"
            variant="primary"
            label={labels.renameTagConfirm}
            disabled={unchanged || !valid}
            onClick={() => {
              if (unchanged || !valid) return;
              onRename(draft);
              onClose();
            }}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
