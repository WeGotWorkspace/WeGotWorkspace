import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";
import { UserAvatar } from "@/user-avatar/src/user-avatar";

import type { ContactCard } from "./contacts-types";
import { contactDisplayName, isContactOrgCard } from "./contacts-display-utils";
import { ContactsGroupIcon } from "./contacts-group-icon";
import { ContactsOrgIcon } from "./contacts-org-icon";
import { isContactGroupCard } from "./contacts-group-utils";
import { useContactPhotoSrc } from "./use-contact-photo-src";

type ContactUserAvatarProps = Omit<
  ComponentProps<typeof UserAvatar>,
  "displayName" | "imageSrc"
> & {
  card?: ContactCard;
  /** Used when `card` is omitted (e.g. create mode). */
  displayName?: string;
};

/** Contact list/detail avatar — loads blob-backed photos with API auth. */
export function ContactUserAvatar({
  card,
  displayName,
  className,
  size,
  ...props
}: ContactUserAvatarProps) {
  const imageSrc = useContactPhotoSrc(card);
  const resolvedName = card ? contactDisplayName(card) : displayName?.trim() || "?";

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
      displayName={resolvedName}
      imageSrc={imageSrc}
      className={className}
      size={size}
      {...props}
      fallback={card && isContactOrgCard(card) ? <ContactsOrgIcon /> : undefined}
    />
  );
}
