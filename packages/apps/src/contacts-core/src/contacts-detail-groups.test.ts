import { describe, expect, it } from "vitest";
import type { ContactCard } from "@/contacts-core/src/contacts-types";
import { contactDetailGroupTags } from "./contacts-detail-groups";
import {
  cardWithAddedGroupMember,
  mergeBootstrapCardsPreservingOptimistic,
} from "./contacts-group-utils";

const writableBooks = [{ id: "default", myRights: { mayWrite: true } }];
const viewOnlyBooks = [{ id: "shared-1", myRights: { mayWrite: false } }];

const jane = {
  "@type": "Card",
  version: "1.0",
  id: "card-jane",
  uid: "urn:uuid:jane",
  addressBookIds: { default: true },
  name: { full: "Jane Doe" },
} as unknown as ContactCard;

const friends = {
  "@type": "Card",
  version: "1.0",
  id: "card-group-friends",
  uid: "urn:uuid:friends",
  kind: "group",
  addressBookIds: { default: true },
  name: { full: "Friends" },
  members: { "urn:uuid:jane": true },
} as unknown as ContactCard;

const family = {
  "@type": "Card",
  version: "1.0",
  id: "card-group-family",
  uid: "urn:uuid:family",
  kind: "group",
  addressBookIds: { default: true },
  name: { full: "Family" },
  members: {},
} as unknown as ContactCard;

const cards = [jane, friends, family];

describe("contactDetailGroupTags", () => {
  it("hides the control on group cards and in create mode", () => {
    expect(
      contactDetailGroupTags({
        card: friends,
        createMode: false,
        groups: [friends, family],
        allCards: cards,
        addressBooks: writableBooks,
        hasOperations: true,
        canCreateGroup: true,
      }).show,
    ).toBe(false);

    expect(
      contactDetailGroupTags({
        card: jane,
        createMode: true,
        groups: [friends, family],
        allCards: cards,
        addressBooks: writableBooks,
        hasOperations: true,
        canCreateGroup: true,
      }).show,
    ).toBe(false);
  });

  it("assigns membership chips and leftover groups as suggestions", () => {
    const model = contactDetailGroupTags({
      card: jane,
      createMode: false,
      groups: [friends, family],
      allCards: cards,
      addressBooks: writableBooks,
      hasOperations: true,
      canCreateGroup: true,
    });

    expect(model.show).toBe(true);
    expect(model.assigned.map((chip) => chip.group.id)).toEqual(["card-group-friends"]);
    expect(model.assigned[0]?.writable).toBe(true);
    expect(model.suggestions.map((group) => group.id)).toEqual(["card-group-family"]);
    expect(model.readonly).toBe(false);
    expect(model.allowCreate).toBe(true);
  });

  it("lists only groups that share an address book with the contact", () => {
    const adminGroup = {
      ...family,
      id: "card-group-admin",
      addressBookIds: { "group-admin": true },
    } as ContactCard;
    const administratorsGroup = {
      ...family,
      id: "card-group-administrators",
      addressBookIds: { "group-administrators": true },
    } as ContactCard;
    const administratorsContact = {
      ...jane,
      id: "card-admins-lead",
      addressBookIds: { "group-administrators": true },
    } as ContactCard;
    const books = [
      { id: "group-admin", myRights: { mayWrite: true } },
      { id: "group-administrators", myRights: { mayWrite: true } },
    ];
    const model = contactDetailGroupTags({
      card: administratorsContact,
      createMode: false,
      groups: [adminGroup, administratorsGroup],
      allCards: [administratorsContact, adminGroup, administratorsGroup],
      addressBooks: books,
      hasOperations: true,
      canCreateGroup: true,
    });

    expect(model.assigned).toEqual([]);
    expect(model.suggestions.map((group) => group.id)).toEqual(["card-group-administrators"]);
    expect(model.allowCreate).toBe(true);
  });

  it("is read-only for a view-only sharee", () => {
    const sharedFriends = {
      ...friends,
      addressBookIds: { "shared-1": true },
    } as ContactCard;
    const model = contactDetailGroupTags({
      card: jane,
      createMode: false,
      groups: [sharedFriends],
      allCards: [jane, sharedFriends],
      addressBooks: viewOnlyBooks,
      hasOperations: true,
      canCreateGroup: false,
    });

    expect(model.show).toBe(true);
    expect(model.readonly).toBe(true);
    expect(model.allowCreate).toBe(false);
  });

  it("keeps the assigned chip after an optimistic add that a stale list payload omits", () => {
    const localFamily = cardWithAddedGroupMember(family, jane);
    const [familyAfterRefresh] = mergeBootstrapCardsPreservingOptimistic([family], [localFamily]);
    const model = contactDetailGroupTags({
      card: jane,
      createMode: false,
      groups: [friends, familyAfterRefresh],
      allCards: [jane, friends, familyAfterRefresh],
      addressBooks: writableBooks,
      hasOperations: true,
      canCreateGroup: true,
    });

    expect(model.assigned.map((chip) => chip.group.id)).toEqual([
      "card-group-friends",
      "card-group-family",
    ]);
  });
});
