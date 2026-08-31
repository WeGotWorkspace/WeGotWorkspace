import type { CSSProperties, ReactElement } from "react";
import { UsersRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { groupAddressBookColor } from "@/contacts-core/src/contacts-addressbook-color";
import "@/contacts-core/src/contacts-group-icon.css";

export type ContactsGroupIconBook = {
  addressBookIds?: Record<string, unknown> | null;
};

export type ContactsGroupIconProps = {
  /** Address-book id, or a group card with `addressBookIds`. Omit for muted ink. */
  book?: string | ContactsGroupIconBook | null;
  className?: string;
};

/** Lucide group glyph tinted with `--collection-row-color` (same token as Tasks lists). */
export function ContactsGroupIcon({ book, className }: ContactsGroupIconProps): ReactElement {
  const color = groupAddressBookColor(book);
  return (
    <UsersRound
      className={cn("contacts-group-icon", className)}
      style={color ? ({ "--collection-row-color": color } as CSSProperties) : undefined}
      aria-hidden
    />
  );
}
