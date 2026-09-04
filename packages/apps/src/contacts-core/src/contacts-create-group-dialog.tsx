import { useEffect, useRef, useState } from "react";
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
  ContactsAddressBookSelect,
  suppressClosedSelectTypeahead,
} from "@/contacts-core/src/contacts-address-book-select";
import type { ContactsAddressBookRow } from "@/contacts-core/src/contacts-addressbook-write";
import { defaultWritableAddressBookId } from "@/contacts-core/src/contacts-addressbook-write";
import { ContactsGroupIcon } from "@/contacts-core/src/contacts-group-icon";
import type { ContactsUILabels } from "@/contacts-core/src/contacts-labels";
import "@/contacts-core/src/contacts-create-group-dialog.css";

export type ContactsCreateGroupDialogLabels = Pick<
  ContactsUILabels,
  | "newGroup"
  | "createGroupNameLabel"
  | "createGroupAddressBookLabel"
  | "createGroupAddressBookHint"
  | "createGroupButton"
  | "cancel"
  | "personalAddressBook"
>;

export function contactsCreateGroupDialogLabelsFrom(
  labels: ContactsUILabels,
): ContactsCreateGroupDialogLabels {
  return {
    newGroup: labels.newGroup,
    createGroupNameLabel: labels.createGroupNameLabel,
    createGroupAddressBookLabel: labels.createGroupAddressBookLabel,
    createGroupAddressBookHint: labels.createGroupAddressBookHint,
    createGroupButton: labels.createGroupButton,
    cancel: labels.cancel,
    personalAddressBook: labels.personalAddressBook,
  };
}

export type ContactsCreateGroupDialogProps = {
  open: boolean;
  books: readonly ContactsAddressBookRow[];
  view: string;
  labels: ContactsCreateGroupDialogLabels;
  onClose: () => void;
  onConfirm: (name: string, addressBookId: string) => void;
  contentClassName?: string;
};

export function ContactsCreateGroupDialog({
  open,
  books,
  view,
  labels,
  onClose,
  onConfirm,
  contentClassName = "contacts-dialog-surface",
}: ContactsCreateGroupDialogProps) {
  const [name, setName] = useState("");
  const [addressBookId, setAddressBookId] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const initializedOpen = useRef(false);

  useEffect(() => {
    if (!open) {
      initializedOpen.current = false;
      return;
    }
    // Once per open — `books` is a new array on every parent render and must
    // not reset a user-selected team book (Admin vs Administrators).
    if (initializedOpen.current) return;
    initializedOpen.current = true;
    setName("");
    setAddressBookId(defaultWritableAddressBookId(view, books) ?? books[0]?.id ?? "");
  }, [open, view, books]);

  const trimmed = name.trim();
  const canSubmit = Boolean(trimmed && addressBookId);

  const selectAddressBookById = (nextId: string) => {
    const book = books.find((row) => row.id === nextId);
    if (!book) return;
    setAddressBookId(book.id);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className={contentClassName}>
        <DialogHeader>
          <DialogTitle className="contacts-create-group-dialog__title">
            <ContactsGroupIcon book={addressBookId || undefined} />
            {labels.newGroup}
          </DialogTitle>
          <DialogDescription className="contacts-create-group-dialog__hint">
            {labels.createGroupAddressBookHint}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit) return;
            onConfirm(trimmed, addressBookId);
          }}
        >
          <div className="contacts-create-group-dialog__fields">
            <FieldLabelRow label={labels.createGroupNameLabel} htmlFor="contacts-create-group-name">
              <Input
                ref={nameInputRef}
                id="contacts-create-group-name"
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </FieldLabelRow>
            <ContactsAddressBookSelect
              id="contacts-create-group-book"
              label={labels.createGroupAddressBookLabel}
              personalLabel={labels.personalAddressBook}
              books={books}
              value={addressBookId}
              onValueChange={selectAddressBookById}
              onTriggerKeyDown={suppressClosedSelectTypeahead}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                nameInputRef.current?.focus();
              }}
            />
          </div>
          <DialogFooter className="contacts-create-group-dialog__footer">
            <Button type="button" variant="outline" onClick={onClose}>
              {labels.cancel}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {labels.createGroupButton}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
