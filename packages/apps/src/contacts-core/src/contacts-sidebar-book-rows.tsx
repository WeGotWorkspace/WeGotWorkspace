import { Eye } from "lucide-react";
import {
  CollectionSidebarMark,
  CollectionSidebarRow,
} from "@/collection-sidebar/src/collection-sidebar-row";
import { ContactsAddressBookIcon } from "@/contacts-core/src/contacts-address-book-icon";
import {
  canOpenAddressBookSettings,
  contactsAddressBookDisplayName,
  contactsBookViewKey,
  isViewOnlyAddressBook,
  type ContactsAddressBookRow,
} from "@/contacts-core/src/contacts-addressbook-write";

export type ContactsSidebarBookRowsProps = {
  books: ContactsAddressBookRow[];
  view: string;
  editLabel: string;
  viewOnlyLabel: string;
  personalLabel?: string;
  onSelect: (bookId: string) => void;
  onEdit: (book: ContactsAddressBookRow) => void;
};

/**
 * The address books of one sidebar section, each with the address book icon. Groups have
 * their own section ({@link ContactsSidebarGroupRows}).
 */
export function ContactsSidebarBookRows({
  books,
  view,
  editLabel,
  viewOnlyLabel,
  personalLabel = "Personal",
  onSelect,
  onEdit,
}: ContactsSidebarBookRowsProps) {
  return (
    <>
      {books.map((book) => (
        <CollectionSidebarRow
          key={book.id}
          name={contactsAddressBookDisplayName(book, personalLabel)}
          color=""
          leading={<ContactsAddressBookIcon />}
          selected={view === contactsBookViewKey(book.id)}
          onSelect={() => onSelect(book.id)}
          onEdit={canOpenAddressBookSettings(book) ? () => onEdit(book) : undefined}
          editLabel={editLabel}
          badges={
            isViewOnlyAddressBook(book) ? (
              <CollectionSidebarMark label={viewOnlyLabel}>
                <Eye className="size-3.5" aria-hidden />
              </CollectionSidebarMark>
            ) : null
          }
        />
      ))}
    </>
  );
}
