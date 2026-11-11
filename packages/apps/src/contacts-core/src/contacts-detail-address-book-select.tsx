import {
  ContactsAddressBookSelect,
  type ContactsAddressBookSelectBook,
} from "@/contacts-core/src/contacts-address-book-select";
import { firstEnabledAddressBookId } from "@/contacts-core/src/contacts-addressbook-color";
import type { ContactsUILabels } from "@/contacts-core/src/contacts-labels";
import type { ContactCard } from "@/lib/models/contacts-types";

/**
 * The contact's address book above its name (Notes-style ghost switcher). It
 * moves the contact when there is somewhere to move it; otherwise it only names
 * the book.
 */
export function ContactsDetailAddressBookSelect({
  card,
  labels,
  addressBooks,
  writableBooks,
  canMove,
  onMove,
}: {
  card: ContactCard;
  labels: ContactsUILabels;
  /** Every book, so a read-only or shared book still shows its name. */
  addressBooks: readonly ContactsAddressBookSelectBook[];
  /** Where the contact may move to. */
  writableBooks: readonly ContactsAddressBookSelectBook[];
  canMove: boolean;
  onMove: (bookId: string) => void;
}) {
  const value = firstEnabledAddressBookId(card.addressBookIds);
  if (!value) return null;
  return (
    <ContactsAddressBookSelect
      variant="toolbar"
      triggerVariant="ghost"
      id="contact-move-address-book"
      label={labels.toolbarMoveToAddressBook}
      personalLabel={labels.personalAddressBook}
      books={canMove ? writableBooks : addressBooks}
      value={value}
      disabled={!canMove}
      onValueChange={onMove}
    />
  );
}
