import type { KeyboardEvent, KeyboardEventHandler } from "react";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { contactsAddressBookDisplayName } from "@/contacts-core/src/contacts-addressbook-write";
import { ContactsGroupIcon } from "@/contacts-core/src/contacts-group-icon";
import "@/contacts-core/src/contacts-address-book-select.css";

/** Closed Radix Select typeahead prefix-matches labels ("Admin" vs "Administrators"). */
export function suppressClosedSelectTypeahead(event: KeyboardEvent<HTMLButtonElement>): void {
  if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
  }
}

export type ContactsAddressBookSelectBook = {
  id: string;
  name: string;
  isSharee?: boolean;
  isDefault?: boolean;
};

export type ContactsAddressBookSelectProps = {
  id: string;
  label: string;
  personalLabel?: string;
  books: readonly ContactsAddressBookSelectBook[];
  value: string;
  disabled?: boolean;
  onValueChange?: (bookId: string) => void;
  onTriggerKeyDown?: KeyboardEventHandler<HTMLButtonElement>;
  onCloseAutoFocus?: (event: Event) => void;
};

/** Options include the selected id so SelectValue can resolve a name when the book is missing. */
export function booksForAddressBookSelect(
  books: readonly ContactsAddressBookSelectBook[],
  selectedId: string,
): ContactsAddressBookSelectBook[] {
  if (!selectedId || books.some((book) => book.id === selectedId)) {
    return [...books];
  }
  return [...books, { id: selectedId, name: selectedId }];
}

export function ContactsAddressBookSelect({
  id,
  label,
  personalLabel = "Personal",
  books,
  value,
  disabled = false,
  onValueChange,
  onTriggerKeyDown,
  onCloseAutoFocus,
}: ContactsAddressBookSelectProps) {
  const options = booksForAddressBookSelect(books, value);

  return (
    <FieldLabelRow label={label} htmlFor={id}>
      <Select value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger id={id} aria-label={label} disabled={disabled} onKeyDown={onTriggerKeyDown}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent onCloseAutoFocus={onCloseAutoFocus}>
          {options.map((book) => {
            const name = contactsAddressBookDisplayName(book, personalLabel);
            return (
              <SelectItem key={book.id} value={book.id} textValue={name}>
                <span className="contacts-address-book-select__option">
                  <ContactsGroupIcon book={book.id} />
                  {name}
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </FieldLabelRow>
  );
}
