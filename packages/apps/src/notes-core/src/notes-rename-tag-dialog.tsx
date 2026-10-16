import { useState, type ReactElement } from "react";
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
import "@/notes-core/src/notes-rename-tag-dialog.css";

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

function NotesRenameTagDialogForm({
  tag,
  existingTags,
  labels,
  onClose,
  onRename,
}: Omit<NotesRenameTagDialogProps, "open">): ReactElement {
  const [draft, setDraft] = useState(tag);
  const normalizedDraft = normalizeTag(draft);
  const unchanged = normalizedDraft === normalizeTag(tag);
  const valid = isValidNewTag(draft);
  const merges =
    valid &&
    !unchanged &&
    existingTags.some((existing) => normalizeTag(existing) === normalizedDraft);

  return (
    <>
      <div className="notes-rename-tag-dialog__body">
        <FieldLabelRow label={labels.renameTagNameLabel} htmlFor={TAG_NAME_INPUT_ID}>
          <Input
            id={TAG_NAME_INPUT_ID}
            value={draft}
            size="sm"
            autoComplete="off"
            onChange={(event) => setDraft(event.target.value)}
          />
        </FieldLabelRow>
        {valid ? null : (
          <p className="notes-rename-tag-dialog__hint" role="status">
            {labels.tagCharsetHint}
          </p>
        )}
        {merges ? (
          <p className="notes-rename-tag-dialog__hint" role="status">
            {labels.renameTagMergeHint(normalizedDraft)}
          </p>
        ) : null}
      </div>
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
    </>
  );
}

export function NotesRenameTagDialog({
  open,
  tag,
  existingTags,
  labels,
  onClose,
  onRename,
}: NotesRenameTagDialogProps): ReactElement {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="notes-dialog-surface notes-rename-tag-dialog">
        <DialogHeader>
          <DialogTitle>{labels.renameTagTitle}</DialogTitle>
          <DialogDescription>{labels.renameTagDescription}</DialogDescription>
        </DialogHeader>
        {open ? (
          <NotesRenameTagDialogForm
            key={tag}
            tag={tag}
            existingTags={existingTags}
            labels={labels}
            onClose={onClose}
            onRename={onRename}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
