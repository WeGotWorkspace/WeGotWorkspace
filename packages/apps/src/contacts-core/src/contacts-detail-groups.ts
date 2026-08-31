import { firstEnabledAddressBookId } from "@/contacts-core/src/contacts-addressbook-color";
import {
  canCreateGroupInAddressBook,
  type ContactsAddressBookRow,
} from "@/contacts-core/src/contacts-addressbook-write";
import {
  canWriteContactGroup,
  contactAndGroupShareAddressBook,
  groupsContainingCard,
  isContactGroupCard,
} from "@/contacts-core/src/contacts-group-utils";
import type { ContactCard } from "@/contacts-core/src/contacts-types";

export type ContactDetailGroupChip = {
  group: ContactCard;
  writable: boolean;
};

export type ContactDetailGroupTagsModel = {
  show: boolean;
  assigned: ContactDetailGroupChip[];
  suggestions: ContactCard[];
  readonly: boolean;
  allowCreate: boolean;
};

/**
 * Groups shown as chips on a person/org contact. Hidden on group cards and
 * create-mode (no card id yet). Assigned chips and suggestions are limited
 * to groups that share an enabled address-book id with the contact.
 */
export function contactDetailGroupTags(args: {
  card?: ContactCard;
  createMode: boolean;
  groups: ContactCard[];
  allCards: ContactCard[];
  addressBooks: readonly { id: string; myRights?: { mayWrite?: boolean } | null }[];
  hasOperations: boolean;
  canCreateGroup: boolean;
}): ContactDetailGroupTagsModel {
  const { card, createMode, groups, allCards, addressBooks, hasOperations, canCreateGroup } = args;
  if (createMode || !card || isContactGroupCard(card)) {
    return {
      show: false,
      assigned: [],
      suggestions: [],
      readonly: true,
      allowCreate: false,
    };
  }

  const eligibleGroups = groups.filter((group) => contactAndGroupShareAddressBook(card, group));
  const assignedGroups = groupsContainingCard(card.id, eligibleGroups, allCards);
  const assignedIds = new Set(assignedGroups.map((group) => group.id));
  const suggestions = eligibleGroups.filter((group) => !assignedIds.has(group.id));
  const assigned = assignedGroups.map((group) => ({
    group,
    writable: canWriteContactGroup(group, addressBooks, hasOperations),
  }));
  const canWriteAny = eligibleGroups.some((group) =>
    canWriteContactGroup(group, addressBooks, hasOperations),
  );
  const contactBookId = firstEnabledAddressBookId(card.addressBookIds);
  const contactBook = addressBooks.find((book) => book.id === contactBookId);
  const allowCreate =
    canCreateGroup &&
    canCreateGroupInAddressBook(contactBook as ContactsAddressBookRow | undefined);

  return {
    show: true,
    assigned,
    suggestions,
    readonly: !canWriteAny && !allowCreate,
    allowCreate,
  };
}
