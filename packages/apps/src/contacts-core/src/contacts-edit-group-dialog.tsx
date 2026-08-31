import { useEffect, useState } from "react";
import { Button } from "@/button/src/button";
import { Input } from "@/ui/input";
import { FieldLabelRow } from "@/ui/field-label-row";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog";
import { firstEnabledAddressBookId } from "@/contacts-core/src/contacts-addressbook-color";
import {
  ContactsAddressBookSelect,
  type ContactsAddressBookSelectBook,
} from "@/contacts-core/src/contacts-address-book-select";
import { ContactsGroupIcon } from "@/contacts-core/src/contacts-group-icon";
import type { ContactsUILabels } from "@/contacts-core/src/contacts-labels";
import "@/contacts-core/src/contacts-edit-group-dialog.css";

export type ContactsEditGroupDialogLabels = Pick<
  ContactsUILabels,
  | "renameGroup"
  | "renameGroupDescription"
  | "createGroupNameLabel"
  | "createGroupAddressBookLabel"
  | "deleteGroup"
  | "deleteGroupTitle"
  | "deleteGroupDescription"
  | "save"
  | "cancel"
  | "delete"
>;

export function contactsEditGroupDialogLabelsFrom(
  labels: ContactsUILabels,
): ContactsEditGroupDialogLabels {
  return {
    renameGroup: labels.renameGroup,
    renameGroupDescription: labels.renameGroupDescription,
    createGroupNameLabel: labels.createGroupNameLabel,
    createGroupAddressBookLabel: labels.createGroupAddressBookLabel,
    deleteGroup: labels.deleteGroup,
    deleteGroupTitle: labels.deleteGroupTitle,
    deleteGroupDescription: labels.deleteGroupDescription,
    save: labels.save,
    cancel: labels.cancel,
    delete: labels.delete,
  };
}

export type ContactsEditGroupDialogProps = {
  open: boolean;
  name: string;
  /** Group membership map — first enabled id is the book's Select value. */
  addressBookIds?: Record<string, unknown> | null;
  books?: readonly ContactsAddressBookSelectBook[];
  labels: ContactsEditGroupDialogLabels;
  canDelete?: boolean;
  onClose: () => void;
  onConfirm: (name: string) => void;
  onDelete?: () => void;
  contentClassName?: string;
};

export function ContactsEditGroupDialog({
  open,
  name,
  addressBookIds,
  books = [],
  labels,
  canDelete = false,
  onClose,
  onConfirm,
  onDelete,
  contentClassName = "contacts-dialog-surface",
}: ContactsEditGroupDialogProps) {
  const [value, setValue] = useState(name);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const showDelete = canDelete && Boolean(onDelete);

  useEffect(() => {
    if (!open) {
      setConfirmDeleteOpen(false);
      return;
    }
    setValue(name);
  }, [open, name]);

  const trimmed = value.trim();
  const canSubmit = Boolean(trimmed);
  const addressBookId = firstEnabledAddressBookId(addressBookIds) ?? "";

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) {
            setConfirmDeleteOpen(false);
            onClose();
          }
        }}
      >
        <DialogContent className={contentClassName}>
          <DialogHeader>
            <DialogTitle className="contacts-edit-group-dialog__title">
              <ContactsGroupIcon book={addressBookId || undefined} />
              {labels.renameGroup}
            </DialogTitle>
            <DialogDescription className="contacts-edit-group-dialog__hint">
              {labels.renameGroupDescription}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!canSubmit) return;
              onConfirm(trimmed);
            }}
          >
            <div className="contacts-edit-group-dialog__fields">
              <FieldLabelRow label={labels.createGroupNameLabel} htmlFor="contacts-edit-group-name">
                <Input
                  id="contacts-edit-group-name"
                  autoFocus
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                />
              </FieldLabelRow>
              <ContactsAddressBookSelect
                id="contacts-edit-group-book"
                label={labels.createGroupAddressBookLabel}
                books={books}
                value={addressBookId}
                disabled
              />
            </div>
            <DialogFooter className="contacts-edit-group-dialog__footer">
              {showDelete ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="contacts-edit-group-dialog__delete"
                  onClick={() => setConfirmDeleteOpen(true)}
                >
                  {labels.deleteGroup}
                </Button>
              ) : null}
              <Button type="button" variant="outline" onClick={onClose}>
                {labels.cancel}
              </Button>
              <Button type="submit" disabled={!canSubmit}>
                {labels.save}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent className={contentClassName}>
          <AlertDialogHeader>
            <AlertDialogTitle>{labels.deleteGroupTitle}</AlertDialogTitle>
            <AlertDialogDescription>{labels.deleteGroupDescription(name)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="outline">{labels.cancel}</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                variant="destructive"
                onClick={(event) => {
                  event.preventDefault();
                  setConfirmDeleteOpen(false);
                  onDelete?.();
                }}
              >
                {labels.delete}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
