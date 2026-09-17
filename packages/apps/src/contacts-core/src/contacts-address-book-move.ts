import { firstEnabledAddressBookId } from "@/contacts-core/src/contacts-addressbook-color";
import { contactsBookViewKey } from "@/contacts-core/src/contacts-addressbook-write";
import {
  groupRemoveMembersPatch,
  groupsContainingCard,
  isContactGroupCard,
} from "@/contacts-core/src/contacts-group-utils";
import type { ContactCard, ContactCardPatch } from "@/contacts-core/src/contacts-types";

export function canShowContactAddressBookMove(args: {
  createMode: boolean;
  canEdit: boolean;
  card?: ContactCard;
  writableBookCount: number;
}): boolean {
  if (args.createMode || !args.canEdit || !args.card) return false;
  if (isContactGroupCard(args.card)) return false;
  return args.writableBookCount >= 2;
}

/** JMAP map patch: drop the source book, enable the destination (one book). */
export function contactMoveAddressBookPatch(
  sourceBookId: string,
  destBookId: string,
): ContactCardPatch {
  return {
    addressBookIds: {
      [sourceBookId]: false,
      [destBookId]: true,
    } as ContactCardPatch["addressBookIds"],
  };
}

export function applyContactAddressBookMove(card: ContactCard, destBookId: string): ContactCard {
  return {
    ...card,
    addressBookIds: { [destBookId]: true },
  };
}

/** Groups that would become cross-book after the contact lands in `destBookId`. */
export function groupsToDropOnAddressBookMove(
  contact: ContactCard,
  groups: readonly ContactCard[],
  allCards: readonly ContactCard[],
  destBookId: string,
): ContactCard[] {
  return groupsContainingCard(contact.id, [...groups], [...allCards]).filter((group) => {
    const bookId = firstEnabledAddressBookId(group.addressBookIds);
    return Boolean(bookId) && bookId !== destBookId;
  });
}

export function applyContactAddressBookMoveToCards(
  cards: readonly ContactCard[],
  contactId: string,
  destBookId: string,
  groupsToDrop: readonly ContactCard[],
): ContactCard[] {
  const dropIds = new Set(groupsToDrop.map((group) => group.id));
  return cards.map((card) => {
    if (card.id === contactId) return applyContactAddressBookMove(card, destBookId);
    if (!dropIds.has(card.id)) return card;
    const patch = groupRemoveMembersPatch(card, [contactId], [...cards]);
    if (!patch) return card;
    return {
      ...card,
      members: { ...card.members, ...patch.members } as ContactCard["members"],
    };
  });
}

/** Keep the moved contact visible: leave a source-book or group view. */
export function contactsViewAfterAddressBookMove(view: string, destBookId: string): string {
  const destView = contactsBookViewKey(destBookId);
  if (view.startsWith("group:")) return destView;
  if (view.startsWith("book:") && view !== destView) return destView;
  return view;
}
