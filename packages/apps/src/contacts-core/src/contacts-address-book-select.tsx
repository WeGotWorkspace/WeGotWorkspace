import type { KeyboardEvent, KeyboardEventHandler } from "react";
import { FieldLabelRow } from "@/ui/field-label-row";
import { CollectionSelect } from "@/ui/collection-select";
import { addressBookDotColor } from "@/contacts-core/src/contacts-addressbook-color";
import { contactsAddressBookDisplayName } from "@/contacts-core/src/contacts-addressbook-write";
import { useAddressBookColorOverrides } from "@/contacts-core/src/use-contacts-addressbook-colors";
import { CollectionColorDot } from "@/ui/collection-color-dot";
import { cn } from "@/lib/utils";

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
  /**
   * `swatch` reuses ColorSwatchTrigger (icon + chevron, no caption) — same chrome as
   * NotesNotebookSelect / CalendarEventCalendarPicker. `labeled` keeps the Select trigger
   * with visible name. `ghost` is the detail-pane switcher above the contact's
   * name: dot + name in the book's colour, no chrome (same as Notes' notebook).
   */
  triggerVariant?: "labeled" | "swatch" | "ghost";
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

export function ContactsAddressBookSelect({
  id,
  label,
  personalLabel = "Personal",
  books,
  value,
  disabled = false,
  variant = "field",
  triggerVariant = "labeled",
  className,
  onValueChange,
  onTriggerKeyDown,
  onCloseAutoFocus,
}: ContactsAddressBookSelectProps) {
  const overrides = useAddressBookColorOverrides();
  const options = booksForAddressBookSelect(books, value);
  const toolbar = variant === "toolbar";
  const swatch = triggerVariant === "swatch";
  const ghost = triggerVariant === "ghost";
  const selectedBook = options.find((book) => book.id === value);
  const bookName = selectedBook ? contactsAddressBookDisplayName(selectedBook, personalLabel) : "";
  // Prefer the address-book name so swatch chrome stays labeled for AT / tooltip.
  const accessibleName = swatch || ghost ? bookName.trim() || label : label;
  const selectedColor = addressBookDotColor(
    selectedBook ?? { id: value, name: bookName || value },
    overrides,
  );

  const select = (
    <CollectionSelect
      items={options.map((book) => ({
        id: book.id,
        name: contactsAddressBookDisplayName(book, personalLabel),
        color: addressBookDotColor(book, overrides),
      }))}
      value={value}
      dot={<CollectionColorDot />}
      color={selectedColor}
      triggerLabel={bookName || label}
      accessibleName={accessibleName}
      triggerVariant={triggerVariant}
      size={swatch && toolbar ? "md" : "sm"}
      fitLabeled={toolbar}
      labeledTooltip={false}
      className={cn(
        (toolbar || triggerVariant !== "labeled") && "contacts-address-book-select",
        triggerVariant !== "labeled" && `contacts-address-book-select--${triggerVariant}`,
        className,
      )}
      menuClassName={ghost ? "collection-ghost-select__menu" : undefined}
      id={id}
      disabled={disabled}
      onValueChange={(next) => onValueChange?.(next)}
      onTriggerKeyDown={onTriggerKeyDown}
      onCloseAutoFocus={onCloseAutoFocus}
    />
  );

  if (toolbar) return select;

  return (
    <FieldLabelRow label={label} htmlFor={id}>
      {select}
    </FieldLabelRow>
  );
}
