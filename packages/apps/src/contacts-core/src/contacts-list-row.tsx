import { memo } from "react";
import { Circle, Trash2, UserMinus } from "lucide-react";
import { ListItem } from "@/list-item/src/list-item";
import { workspaceListRowPropsEqual } from "@/workspace-list/src/workspace-list-row-props";
import type { ContactCard } from "@/lib/models/contacts-types";
import {
  contactDisplayName,
  contactListDetail,
  contactListSubtitle,
} from "@/contacts-core/src/contacts-display-utils";
import type { ContactsUILabels } from "@/contacts-core/src/contacts-labels";
import type { ContactsAddressBookSelectBook } from "@/contacts-core/src/contacts-address-book-select";
import { addressBookDotColor } from "@/contacts-core/src/contacts-addressbook-color";
import { contactsAddressBookDisplayName } from "@/contacts-core/src/contacts-addressbook-write";
import { useAddressBookColorOverrides } from "@/contacts-core/src/use-contacts-addressbook-colors";
import { ContactUserAvatar } from "@/contacts-core/src/contact-user-avatar";
import { CollectionColorDot } from "@/ui/collection-color-dot";

/** A row's meta line: its address book (dot + name), as Notes rows show the notebook. */
function ContactsListAddressBook({
  book,
  personalLabel,
}: {
  book: ContactsAddressBookSelectBook;
  personalLabel: string;
}) {
  const overrides = useAddressBookColorOverrides();
  return (
    <span className="contacts-list-panel__book">
      <CollectionColorDot color={addressBookDotColor(book, overrides)} />
      <span className="contacts-list-panel__book-name">
        {contactsAddressBookDisplayName(book, personalLabel)}
      </span>
    </span>
  );
}

export type ContactsListRowProps = {
  L: ContactsUILabels;
  card: ContactCard;
  book: ContactsAddressBookSelectBook | undefined;
  isPendingSync: boolean;
  isTouch: boolean;
  isDragging: boolean;
  /** In a group, a swipe removes the card from the group instead of deleting it. */
  inGroup: boolean;
  onSwipeDelete: (id: string) => void;
  onSwipeRemoveFromGroup: (id: string) => void;
};

/** One contact in the list. Memoized with the shared list comparison (#1641 step d). */
export const ContactsListRow = memo(function ContactsListRow({
  L,
  card,
  book,
  isPendingSync,
  isTouch,
  isDragging,
  inGroup,
  onSwipeDelete,
  onSwipeRemoveFromGroup,
}: ContactsListRowProps) {
  return (
    <ListItem
      id={card.id}
      title={contactDisplayName(card)}
      /* Suite list norm: the name, then company (else email, else phone),
         then the address book on the quiet meta line. */
      text={contactListSubtitle(card) || contactListDetail(card) || null}
      subtitle={
        book ? <ContactsListAddressBook book={book} personalLabel={L.personalAddressBook} /> : null
      }
      metaPosition="below"
      date=""
      icons={[
        isPendingSync ? (
          <span className="contacts-list-panel__pending-dot" role="img" aria-label={L.pendingSync}>
            <Circle className="size-2.5" fill="currentColor" strokeWidth={0} />
          </span>
        ) : null,
      ].filter(Boolean)}
      leading={
        <ContactUserAvatar
          card={card}
          compact
          size="md"
          className="contacts-list-panel__avatar"
          loading="lazy"
          decoding="async"
        />
      }
      isActive={false}
      isSelected={false}
      selectionMode={false}
      isTouch={isTouch}
      isDragging={isDragging}
      emptyTitle={L.unknownContact}
      {...(isTouch
        ? inGroup
          ? {
              swipeRightAction: {
                icon: <UserMinus className="size-5" />,
                label: L.swipeRemoveFromGroup,
                onActivate: () => onSwipeRemoveFromGroup(card.id),
              },
            }
          : {
              swipeRightAction: {
                icon: <Trash2 className="size-5" />,
                tone: "danger" as const,
                label: L.swipeDelete,
                onActivate: () => onSwipeDelete(card.id),
              },
            }
        : {})}
    />
  );
}, workspaceListRowPropsEqual);
