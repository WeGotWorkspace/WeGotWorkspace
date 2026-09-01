import { Eye } from "lucide-react";
import {
  CollectionSidebarMark,
  CollectionSidebarRow,
} from "@/collection-sidebar/src/collection-sidebar-row";
import { addressBookDotColor } from "@/contacts-core/src/contacts-addressbook-color";
import { useAddressBookColorOverrides } from "@/contacts-core/src/use-contacts-addressbook-colors";
import {
  canOpenAddressBookSettings,
  contactsBookViewKey,
  isViewOnlyAddressBook,
  type ContactsAddressBookRow,
} from "@/contacts-core/src/contacts-addressbook-write";

export type ContactsSidebarBookRowsProps = {
  books: ContactsAddressBookRow[];
  view: string;
  editLabel: string;
  viewOnlyLabel: string;
  hiddenAddressBookIds: ReadonlySet<string>;
  onToggleVisibility: (bookId: string) => void;
  onSelect: (bookId: string) => void;
  onEdit: (book: ContactsAddressBookRow) => void;
};

export function ContactsSidebarBookRows({
  books,
  view,
  editLabel,
  viewOnlyLabel,
  hiddenAddressBookIds,
  onToggleVisibility,
  onSelect,
  onEdit,
}: ContactsSidebarBookRowsProps) {
  const colorOverrides = useAddressBookColorOverrides();
  return (
    <>
      {books.map((book) => {
        const viewOnly = isViewOnlyAddressBook(book);
        return (
          <CollectionSidebarRow
            key={book.id}
            name={book.name}
            color={addressBookDotColor(book, colorOverrides)}
            selected={view === contactsBookViewKey(book.id)}
            visible={!hiddenAddressBookIds.has(book.id)}
            onToggleVisibility={() => onToggleVisibility(book.id)}
            onSelect={() => onSelect(book.id)}
            onEdit={canOpenAddressBookSettings(book) ? () => onEdit(book) : undefined}
            editLabel={editLabel}
            badges={
              viewOnly ? (
                <CollectionSidebarMark label={viewOnlyLabel}>
                  <Eye className="size-3.5" aria-hidden />
                </CollectionSidebarMark>
              ) : null
            }
          />
        );
      })}
    </>
  );
}
