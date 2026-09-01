import { describe, expect, it } from "vitest";
import {
  applyContactAddressBookMove,
  applyContactAddressBookMoveToCards,
  canShowContactAddressBookMove,
  contactMoveAddressBookPatch,
  contactsViewAfterAddressBookMove,
  groupsToDropOnAddressBookMove,
} from "@/contacts-core/src/contacts-address-book-move";
import type { ContactCard } from "@/contacts-core/src/contacts-types";

const jane = {
  id: "card-jane",
  uid: "urn:uuid:jane",
  addressBookIds: { default: true },
  name: { full: "Jane" },
} as ContactCard;

const joe = {
  id: "card-joe",
  uid: "urn:uuid:joe",
  addressBookIds: { work: true },
  name: { full: "Joe" },
} as ContactCard;

const friends = {
  id: "card-group-friends",
  uid: "urn:uuid:friends",
  kind: "group",
  addressBookIds: { default: true },
  name: { full: "Friends" },
  members: { "urn:uuid:jane": true, "urn:uuid:joe": true },
} as ContactCard;

const family = {
  id: "card-group-family",
  uid: "urn:uuid:family",
  kind: "group",
  addressBookIds: { default: true },
  name: { full: "Family" },
  members: { "urn:uuid:jane": true },
} as ContactCard;

const workLeads = {
  id: "card-group-work",
  uid: "urn:uuid:work-leads",
  kind: "group",
  addressBookIds: { work: true },
  name: { full: "Leads" },
  members: { "urn:uuid:joe": true },
} as ContactCard;

const cards = [jane, joe, friends, family, workLeads];
const groups = [friends, family, workLeads];

describe("canShowContactAddressBookMove", () => {
  it("shows only for a writable person card when two books exist", () => {
    expect(
      canShowContactAddressBookMove({
        createMode: false,
        canEdit: true,
        card: jane,
        writableBookCount: 2,
      }),
    ).toBe(true);
    expect(
      canShowContactAddressBookMove({
        createMode: false,
        canEdit: true,
        card: jane,
        writableBookCount: 1,
      }),
    ).toBe(false);
    expect(
      canShowContactAddressBookMove({
        createMode: false,
        canEdit: false,
        card: jane,
        writableBookCount: 2,
      }),
    ).toBe(false);
    expect(
      canShowContactAddressBookMove({
        createMode: true,
        canEdit: true,
        card: jane,
        writableBookCount: 2,
      }),
    ).toBe(false);
    expect(
      canShowContactAddressBookMove({
        createMode: false,
        canEdit: true,
        card: friends,
        writableBookCount: 2,
      }),
    ).toBe(false);
  });
});

describe("contactMoveAddressBookPatch", () => {
  it("drops the source book and enables the destination", () => {
    expect(contactMoveAddressBookPatch("default", "work")).toEqual({
      addressBookIds: { default: false, work: true },
    });
  });
});

describe("applyContactAddressBookMove", () => {
  it("leaves the card in exactly one destination book", () => {
    expect(applyContactAddressBookMove(jane, "work").addressBookIds).toEqual({ work: true });
  });
});

describe("groupsToDropOnAddressBookMove", () => {
  it("drops source-book memberships and keeps same-book groups", () => {
    expect(
      groupsToDropOnAddressBookMove(jane, groups, cards, "work").map((group) => group.id),
    ).toEqual(["card-group-friends", "card-group-family"]);
    expect(
      groupsToDropOnAddressBookMove(joe, groups, cards, "default").map((group) => group.id),
    ).toEqual(["card-group-work"]);
  });
});

describe("applyContactAddressBookMoveToCards", () => {
  it("moves the card and clears source-book group members", () => {
    const next = applyContactAddressBookMoveToCards(
      cards,
      jane.id,
      "work",
      groupsToDropOnAddressBookMove(jane, groups, cards, "work"),
    );
    const moved = next.find((card) => card.id === jane.id);
    const nextFriends = next.find((card) => card.id === friends.id);
    const nextFamily = next.find((card) => card.id === family.id);

    expect(moved?.addressBookIds).toEqual({ work: true });
    expect(nextFriends?.members).toMatchObject({ "urn:uuid:jane": false, "urn:uuid:joe": true });
    expect(nextFamily?.members).toMatchObject({ "urn:uuid:jane": false });
  });
});

describe("contactsViewAfterAddressBookMove", () => {
  it("follows the contact out of a source book or group view", () => {
    expect(contactsViewAfterAddressBookMove("book:default", "work")).toBe("book:work");
    expect(contactsViewAfterAddressBookMove("group:card-group-friends", "work")).toBe("book:work");
    expect(contactsViewAfterAddressBookMove("all", "work")).toBe("all");
    expect(contactsViewAfterAddressBookMove("book:work", "work")).toBe("book:work");
  });
});
