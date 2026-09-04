import { useCallback, useEffect, useState } from "react";
import { useAppToast } from "@/hooks/use-app-toast";
import type { CollectionShareWith } from "@/share-ui/collection-share";
import type { ContactsUILabels } from "@/contacts-core/src/contacts-labels";
import type { AddressBook, AddressBookMutationPatch } from "@/contacts-core/src/contacts-types";
import {
  addressBookDialogFromRow,
  addressBookPatchOp,
  canHideSharedAddressBook,
  contactsBookViewKey,
  type ContactsAddressBookDialogState,
  type ContactsAddressBookOperations,
  type ContactsAddressBookRow,
} from "@/contacts-core/src/contacts-addressbook-write";

type UseContactsAddressBookMutationsArgs = {
  labels: ContactsUILabels;
  operations?: ContactsAddressBookOperations;
  addressBooks: AddressBook[];
  view: string;
  selectView: (view: string) => void;
};

function asBookRows(books: AddressBook[]): ContactsAddressBookRow[] {
  return books as ContactsAddressBookRow[];
}

export function useContactsAddressBookMutations({
  labels,
  operations,
  addressBooks,
  view,
  selectView,
}: UseContactsAddressBookMutationsArgs) {
  const { show, showError } = useAppToast();
  const [books, setBooks] = useState<ContactsAddressBookRow[]>(() => asBookRows(addressBooks));
  const [addressBookDialog, setAddressBookDialog] = useState<ContactsAddressBookDialogState>(null);

  useEffect(() => {
    setBooks(asBookRows(addressBooks));
  }, [addressBooks]);

  const showMutationError = useCallback(() => {
    showError("Could not sync this change. Please try again.");
  }, [showError]);

  const visibleBooks = books.filter((book) => book.isSubscribed !== false);

  const openEditAddressBookDialog = useCallback(
    (book: ContactsAddressBookRow) => {
      const current = books.find((item) => item.id === book.id) ?? book;
      setAddressBookDialog(addressBookDialogFromRow(current, labels.personalAddressBook));
    },
    [books, labels.personalAddressBook],
  );

  const patchShareWith = useCallback(
    async (bookId: string, shareWith: CollectionShareWith) => {
      const patchAddressBook = addressBookPatchOp(operations);
      if (!patchAddressBook) {
        throw new Error(labels.shareAddressBookOffline);
      }
      try {
        const updated = await patchAddressBook(bookId, {
          shareWith: shareWith as AddressBookMutationPatch["shareWith"],
        });
        const nextShareWith = (updated?.shareWith ?? shareWith) as CollectionShareWith;
        setBooks((prev) =>
          prev.map((item) => {
            if (item.id !== bookId) return item;
            const next: ContactsAddressBookRow = {
              ...item,
              ...(updated ?? {}),
              shareWith: nextShareWith as ContactsAddressBookRow["shareWith"],
            };
            return next;
          }),
        );
        setAddressBookDialog((current) =>
          current?.bookId === bookId ? { ...current, shareWith: nextShareWith } : current,
        );
      } catch (error) {
        showMutationError();
        throw error;
      }
    },
    [labels.shareAddressBookOffline, operations, showMutationError],
  );

  const hideSharedAddressBook = useCallback(
    async (bookId: string) => {
      const current = books.find((item) => item.id === bookId);
      if (!current || !canHideSharedAddressBook(current)) return;
      const patchAddressBook = addressBookPatchOp(operations);
      if (!patchAddressBook) return;
      try {
        await patchAddressBook(bookId, { isSubscribed: false });
        setBooks((prev) => prev.filter((item) => item.id !== bookId));
        if (view === contactsBookViewKey(bookId)) {
          selectView("all");
        }
        show(labels.toastAddressBookShareRemoved);
        setAddressBookDialog(null);
      } catch {
        showMutationError();
      }
    },
    [
      books,
      labels.toastAddressBookShareRemoved,
      operations,
      selectView,
      show,
      showMutationError,
      view,
    ],
  );

  return {
    books: visibleBooks,
    addressBookDialog,
    setAddressBookDialog,
    openEditAddressBookDialog,
    patchShareWith,
    hideSharedAddressBook,
  };
}
