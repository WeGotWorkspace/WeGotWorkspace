import type { CSSProperties, KeyboardEvent, KeyboardEventHandler } from "react";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { addressBookDotColor } from "@/contacts-core/src/contacts-addressbook-color";
import { contactsAddressBookDisplayName } from "@/contacts-core/src/contacts-addressbook-write";
import { useAddressBookColorOverrides } from "@/contacts-core/src/use-contacts-addressbook-colors";
import { NotesNotebookColorIcon } from "@/notes-core/src/notes-notebook-color-icon";
import { cn } from "@/lib/utils";
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
  id?: string;
  label: string;
  personalLabel?: string;
  books: readonly ContactsAddressBookSelectBook[];
  value: string;
  disabled?: boolean;
  /** Field = labeled dialog row. Toolbar = Notes notebook switcher chrome. */
  variant?: "field" | "toolbar";
  className?: string;
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

function AddressBookSelectOption({
  book,
  personalLabel,
}: {
  book: ContactsAddressBookSelectBook;
  personalLabel: string;
}) {
  const overrides = useAddressBookColorOverrides();
  const name = contactsAddressBookDisplayName(book, personalLabel);
  return (
    <span
      className="contacts-address-book-select__option"
      style={{ "--collection-row-color": addressBookDotColor(book, overrides) } as CSSProperties}
    >
      <NotesNotebookColorIcon />
      <span className="contacts-address-book-select__name">{name}</span>
    </span>
  );
}

export function ContactsAddressBookSelect({
  id,
  label,
  personalLabel = "Personal",
  books,
  value,
  disabled = false,
  variant = "field",
  className,
  onValueChange,
  onTriggerKeyDown,
  onCloseAutoFocus,
}: ContactsAddressBookSelectProps) {
  const options = booksForAddressBookSelect(books, value);
  const toolbar = variant === "toolbar";

  const select = (
    <Select
      value={value}
      onValueChange={(next) => {
        if (!next || next === value) return;
        onValueChange?.(next);
      }}
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        size={toolbar ? "sm" : undefined}
        className={cn(toolbar && "contacts-address-book-select", className)}
        aria-label={label}
        disabled={disabled}
        onKeyDown={onTriggerKeyDown}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent onCloseAutoFocus={onCloseAutoFocus}>
        {options.map((book) => {
          const name = contactsAddressBookDisplayName(book, personalLabel);
          return (
            <SelectItem key={book.id} value={book.id} textValue={name}>
              <AddressBookSelectOption book={book} personalLabel={personalLabel} />
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );

  if (toolbar) return select;

  return (
    <FieldLabelRow label={label} htmlFor={id}>
      {select}
    </FieldLabelRow>
  );
}
