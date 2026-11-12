import { useEffect, useRef, useState } from "react";
import { Button } from "@/button/src/button";
import { ImportDialog } from "@/import-dialog/src/import-dialog";
import { DialogFooter } from "@/ui/dialog";
import { FieldLabelRow } from "@/ui/field-label-row";
import {
  ContactsAddressBookSelect,
  suppressClosedSelectTypeahead,
} from "@/contacts-core/src/contacts-address-book-select";
import type { ContactsAddressBookRow } from "@/contacts-core/src/contacts-addressbook-write";
import {
  defaultWritableAddressBookId,
  writableOwnedAddressBooks,
} from "@/contacts-core/src/contacts-addressbook-write";
import type { ContactsUILabels } from "@/contacts-core/src/contacts-labels";
import type { VcardImportProgress } from "@/contacts-core/src/contacts-vcard-import";

export type ContactsImportDialogLabels = Pick<
  ContactsUILabels,
  | "importDialogTitle"
  | "importDestinationLegend"
  | "importSubmit"
  | "cancel"
  | "importProgress"
  | "personalAddressBook"
>;

export function contactsImportDialogLabelsFrom(
  labels: ContactsUILabels,
): ContactsImportDialogLabels {
  return {
    importDialogTitle: labels.importDialogTitle,
    importDestinationLegend: labels.importDestinationLegend,
    importSubmit: labels.importSubmit,
    cancel: labels.cancel,
    importProgress: labels.importProgress,
    personalAddressBook: labels.personalAddressBook,
  };
}

export type ContactsImportDialogProps = {
  open: boolean;
  files: File[];
  books: readonly ContactsAddressBookRow[];
  view: string;
  labels: ContactsImportDialogLabels;
  busy?: boolean;
  error?: string | null;
  progress?: VcardImportProgress | null;
  onClose: () => void;
  onImport: (files: File[], addressBookId: string) => void;
  contentClassName?: string;
};

export function ContactsImportDialog({
  open,
  files,
  books,
  view,
  labels,
  busy = false,
  error = null,
  progress = null,
  onClose,
  onImport,
  contentClassName = "contacts-dialog-surface",
}: ContactsImportDialogProps) {
  const writable = writableOwnedAddressBooks(books);
  const [addressBookId, setAddressBookId] = useState("");
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
    setAddressBookId(
      defaultWritableAddressBookId(view, books) ?? writableOwnedAddressBooks(books)[0]?.id ?? "",
    );
  }, [open, view, books]);

  const canSubmit = Boolean(addressBookId) && files.length > 0 && !busy;

  const selectAddressBookById = (nextId: string) => {
    const book = writable.find((row) => row.id === nextId);
    if (!book) return;
    setAddressBookId(book.id);
  };

  return (
    <ImportDialog
      open={open}
      title={labels.importDialogTitle}
      progress={
        busy && progress
          ? {
              value:
                progress.totalCards === 0
                  ? 0
                  : (progress.importedCards / progress.totalCards) * 100,
              text: labels.importProgress(
                progress.importedCards,
                progress.totalCards,
                progress.batchIndex,
                progress.batchCount,
              ),
            }
          : null
      }
      error={error}
      busy={busy}
      onClose={onClose}
      className={contentClassName}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit) return;
          onImport(files, addressBookId);
        }}
      >
        <FieldLabelRow
          layout="inline"
          label={labels.importDestinationLegend}
          htmlFor="contacts-import-book"
        >
          <ContactsAddressBookSelect
            id="contacts-import-book"
            label={labels.importDestinationLegend}
            personalLabel={labels.personalAddressBook}
            books={writable}
            value={addressBookId}
            disabled={busy}
            variant="toolbar"
            triggerVariant="ghost"
            onValueChange={selectAddressBookById}
            onTriggerKeyDown={suppressClosedSelectTypeahead}
          />
        </FieldLabelRow>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {labels.cancel}
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {labels.importSubmit}
          </Button>
        </DialogFooter>
      </form>
    </ImportDialog>
  );
}
