import type { ComponentProps, CSSProperties } from "react";

import { cn } from "@/lib/utils";
import { UserAvatar } from "@/user-avatar/src/user-avatar";

import type { ContactCard } from "./contacts-types";
import { addressBookDotColor, firstEnabledAddressBookId } from "./contacts-addressbook-color";
import { contactDisplayName, isContactOrgCard } from "./contacts-display-utils";
import { ContactsGroupIcon } from "./contacts-group-icon";
import { ContactsOrgIcon } from "./contacts-org-icon";
import { isContactGroupCard } from "./contacts-group-utils";
import { useAddressBookColorOverrides } from "./use-contacts-addressbook-colors";
import { useContactPhotoSrc } from "./use-contact-photo-src";
import "@/contacts-core/src/contact-user-avatar.css";

type ContactUserAvatarProps = Omit<
  ComponentProps<typeof UserAvatar>,
  "displayName" | "imageSrc"
> & {
  card?: ContactCard;
  /** Used when `card` is omitted (e.g. create mode). */
  displayName?: string;
};

function contactAvatarBookStyle(bookColor: string | undefined): CSSProperties | undefined {
  return bookColor ? ({ "--contacts-book-color": bookColor } as CSSProperties) : undefined;
}

/** Contact list/detail avatar — loads blob-backed photos with API auth. */
export function ContactUserAvatar({
  card,
  displayName,
  className,
  size,
  style,
  ...props
}: ContactUserAvatarProps) {
  const imageSrc = useContactPhotoSrc(card);
  const colorOverrides = useAddressBookColorOverrides();
  const resolvedName = card ? contactDisplayName(card) : displayName?.trim() || "?";
  const bookId = firstEnabledAddressBookId(card?.addressBookIds);
  const bookColor = bookId ? addressBookDotColor({ id: bookId }, colorOverrides) : undefined;
  const bookStyle = contactAvatarBookStyle(bookColor);

  if (card && isContactGroupCard(card)) {
    return (
      <span
        className={cn(
          "contacts-group-icon-slot",
          size === "xl"
            ? "contacts-group-icon-slot--xl"
            : size === "lg"
              ? "contacts-group-icon-slot--lg"
              : undefined,
          className,
        )}
        role="img"
        aria-label={resolvedName}
      >
        <ContactsGroupIcon book={card} />
      </span>
    );
  }

  return (
    <UserAvatar
      {...props}
      displayName={resolvedName}
      imageSrc={imageSrc}
      className={cn("contacts-user-avatar", className)}
      size={size}
      style={bookStyle ? { ...style, ...bookStyle } : style}
      fallback={card && isContactOrgCard(card) ? <ContactsOrgIcon /> : undefined}
    />
  );
}
