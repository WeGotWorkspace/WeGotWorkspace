import { useEffect, useRef, useState } from "react";
import { Button } from "@/button/src/button";
import { Callout } from "@/callout/src/callout";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
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
import "@/contacts-core/src/contacts-import-dialog.css";

export type ContactsImportDialogLabels = Pick<
  ContactsUILabels,
  "importDialogTitle" | "importDestinationLegend" | "importSubmit" | "cancel" | "importProgress"
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
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className={contentClassName} aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{labels.importDialogTitle}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit) return;
            onImport(files, addressBookId);
          }}
        >
          <div className="contacts-import-dialog__fields">
            {error ? <Callout severity="error" title={error} /> : null}
            {busy && progress ? (
              <div className="contacts-import-dialog__progress" aria-live="polite" aria-busy="true">
                <p>
                  {labels.importProgress(
                    progress.importedCards,
                    progress.totalCards,
                    progress.batchIndex,
                    progress.batchCount,
                  )}
                </p>
                <div
                  className="contacts-import-dialog__progress-track"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={progress.totalCards}
                  aria-valuenow={progress.importedCards}
                >
                  <div
                    className="contacts-import-dialog__progress-fill"
                    style={{
                      width: `${
                        progress.totalCards === 0
                          ? 0
                          : Math.min(100, (progress.importedCards / progress.totalCards) * 100)
                      }%`,
                    }}
                  />
                </div>
              </div>
            ) : null}
            <ContactsAddressBookSelect
              id="contacts-import-book"
              label={labels.importDestinationLegend}
              books={writable}
              value={addressBookId}
              disabled={busy}
              onValueChange={selectAddressBookById}
              onTriggerKeyDown={suppressClosedSelectTypeahead}
            />
          </div>
          <DialogFooter className="contacts-import-dialog__footer">
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              {labels.cancel}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {labels.importSubmit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
