import type { CSSProperties, KeyboardEvent, KeyboardEventHandler } from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { ColorSwatchTrigger } from "@/ui/color-swatch-trigger";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
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
  /**
   * `swatch` reuses ColorSwatchTrigger (icon + chevron, no caption) — same chrome as
   * NotesNotebookSelect / CalendarEventCalendarPicker. `labeled` keeps the Select trigger
   * with visible name.
   */
  triggerVariant?: "labeled" | "swatch";
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
  const selectedBook = options.find((book) => book.id === value);
  const bookName = selectedBook ? contactsAddressBookDisplayName(selectedBook, personalLabel) : "";
  // Prefer the address-book name so swatch chrome stays labeled for AT / tooltip.
  const accessibleName = swatch ? bookName.trim() || label : label;

  const trigger = swatch ? (
    <SelectPrimitive.Trigger asChild disabled={disabled}>
      <ColorSwatchTrigger
        id={id}
        label={accessibleName}
        disabled={disabled}
        onKeyDown={onTriggerKeyDown}
        icon={
          <span
            className="contacts-address-book-select__option"
            style={
              {
                "--collection-row-color": addressBookDotColor(
                  selectedBook ?? { id: value, name: bookName || value },
                  overrides,
                ),
              } as CSSProperties
            }
          >
            <NotesNotebookColorIcon />
          </span>
        }
        className={cn(
          "contacts-address-book-select",
          "contacts-address-book-select--swatch",
          className,
        )}
      />
    </SelectPrimitive.Trigger>
  ) : (
    <SelectTrigger
      id={id}
      size={toolbar ? "sm" : undefined}
      className={cn(toolbar && "contacts-address-book-select", className)}
      aria-label={accessibleName}
      disabled={disabled}
      onKeyDown={onTriggerKeyDown}
    >
      <SelectValue />
    </SelectTrigger>
  );

  const select = (
    <Select
      value={value}
      onValueChange={(next) => {
        if (!next || next === value) return;
        onValueChange?.(next);
      }}
      disabled={disabled}
    >
      {swatch ? (
        <Tooltip>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent>{accessibleName}</TooltipContent>
        </Tooltip>
      ) : (
        trigger
      )}
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
