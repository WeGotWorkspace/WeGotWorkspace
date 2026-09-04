import {
  enabledAddressBookIds,
  firstEnabledAddressBookId,
} from "@/contacts-core/src/contacts-addressbook-color";
import {
  contactDisplayName,
  contactListSortName,
} from "@/contacts-core/src/contacts-display-utils";
import type { ContactCard, ContactCardPatch } from "@/contacts-core/src/contacts-types";

type AddressBookIdSource = {
  addressBookIds?: Record<string, unknown> | null;
};

/**
 * Contact and group share at least one enabled address-book id.
 * Comparison is exact (`group-admin` ≠ `group-administrators`).
 */
export function contactAndGroupShareAddressBook(
  contact: AddressBookIdSource | null | undefined,
  group: AddressBookIdSource | null | undefined,
): boolean {
  const groupIds = new Set(enabledAddressBookIds(group?.addressBookIds));
  if (groupIds.size === 0) return false;
  return enabledAddressBookIds(contact?.addressBookIds).some((id) => groupIds.has(id));
}

/**
 * JSContact / CardDAV group mapping (RFC 9553 + RFC 9610):
 * - vCard `KIND:group` and Apple `X-ADDRESSBOOKSERVER-KIND:group` → `kind: "group"`.
 * - vCard `MEMBER` / `X-ABGroupMember` URIs → `members` map (member uid → true).
 * - JMAP Contacts uses the same `kind` + `members` fields; REST list/get includes them after
 *   vCard conversion. Optional `memberCardIds` (uid → card id) is added server-side when a
 *   member uid resolves in the user's address books (not in OpenAPI yet).
 */
export type ContactCardWithResolvedMembers = ContactCard & {
  memberCardIds?: Record<string, string>;
};

function vCardPropIndicatesGroup(card: ContactCard): boolean {
  const props = card.vCardProps;
  if (!props?.length) return false;
  for (const tuple of props) {
    if (!Array.isArray(tuple) || tuple.length < 4) continue;
    const name = String(tuple[0]).toUpperCase();
    if (name !== "KIND" && name !== "X-ADDRESSBOOKSERVER-KIND") continue;
    const raw = tuple[3];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (String(value).toLowerCase() === "group") return true;
  }
  return false;
}

function hasGroupMembers(card: ContactCard): boolean {
  const members = card.members;
  if (!members) return false;
  return Object.values(members).some(Boolean);
}

export function isContactGroupCard(card: ContactCard): boolean {
  if (card.kind === "group") return true;
  if (hasGroupMembers(card)) return true;
  return vCardPropIndicatesGroup(card);
}

export function listContactGroups(cards: ContactCard[]): ContactCard[] {
  return cards.filter(isContactGroupCard).sort((left, right) =>
    contactDisplayName(left).localeCompare(contactDisplayName(right), undefined, {
      sensitivity: "base",
    }),
  );
}

/** Groups stored in `bookId` (first enabled `addressBookIds` key). Orphans omitted. */
export function groupsInAddressBook(groups: readonly ContactCard[], bookId: string): ContactCard[] {
  return groups.filter((group) => firstEnabledAddressBookId(group.addressBookIds) === bookId);
}

function enabledMemberUids(members: ContactCard["members"]): string[] {
  if (!members) return [];
  return Object.entries(members)
    .filter(([, enabled]) => Boolean(enabled))
    .map(([uid]) => uid);
}

/** Apple CardDAV: group members often use urn:uuid: while card uid is bare UUID. */
function normalizeContactUidForMatch(uid: string): string {
  const trimmed = uid.trim();
  if (trimmed.toLowerCase().startsWith("urn:uuid:")) {
    return trimmed.slice("urn:uuid:".length).toLowerCase();
  }
  return trimmed.toLowerCase();
}

/** Canonical member-map / vCard member URI for Apple CardDAV (urn:uuid: prefix). */
function memberUidForGroupMap(uid: string): string {
  const trimmed = uid.trim();
  if (trimmed.toLowerCase().startsWith("urn:uuid:")) {
    return trimmed;
  }
  return `urn:uuid:${trimmed}`;
}

function memberCardIdFromApi(
  memberCardIds: ContactCardWithResolvedMembers["memberCardIds"],
  uid: string,
): string | undefined {
  if (!memberCardIds) return undefined;
  const direct = memberCardIds[uid];
  if (direct) return direct;
  const normalized = normalizeContactUidForMatch(uid);
  for (const [key, cardId] of Object.entries(memberCardIds)) {
    if (normalizeContactUidForMatch(key) === normalized) {
      return cardId;
    }
  }
  return undefined;
}

function resolvedMemberCardIdsFromApiOnly(
  groupCard: ContactCard,
  allCards: ContactCard[],
): string[] {
  const memberCardIds = (groupCard as ContactCardWithResolvedMembers).memberCardIds;
  if (!memberCardIds) return [];

  const cardById = new Map(allCards.map((card) => [card.id, card]));
  const resolved: string[] = [];
  const seenIds = new Set<string>();
  for (const cardId of Object.values(memberCardIds)) {
    const card = cardById.get(cardId);
    if (!card || isContactGroupCard(card) || seenIds.has(cardId)) continue;
    seenIds.add(cardId);
    resolved.push(cardId);
  }
  return resolved;
}

function indexCardsByNormalizedUid(cards: ContactCard[]): Map<string, ContactCard> {
  const byUid = new Map<string, ContactCard>();
  for (const card of cards) {
    if (!card.uid) continue;
    byUid.set(normalizeContactUidForMatch(card.uid), card);
  }
  return byUid;
}

type GroupMemberCardIndexes = {
  cardById: Map<string, ContactCard>;
  cardByNormalizedUid: Map<string, ContactCard>;
};

function cardIndexesFor(allCards: ContactCard[]): GroupMemberCardIndexes {
  return {
    cardById: new Map(allCards.map((card) => [card.id, card])),
    cardByNormalizedUid: indexCardsByNormalizedUid(allCards),
  };
}

/** Resolve group member uids to loaded card ids (API memberCardIds first, then uid scan). */
export function resolveGroupMemberCardIds(
  groupCard: ContactCard,
  allCards: ContactCard[],
  indexes?: GroupMemberCardIndexes,
): string[] {
  const memberUids = enabledMemberUids(groupCard.members);
  if (memberUids.length === 0) {
    return resolvedMemberCardIdsFromApiOnly(groupCard, allCards);
  }

  const { cardById, cardByNormalizedUid } = indexes ?? cardIndexesFor(allCards);
  const memberCardIds = (groupCard as ContactCardWithResolvedMembers).memberCardIds;

  const resolved: string[] = [];
  const seenIds = new Set<string>();
  for (const uid of memberUids) {
    const fromApi = memberCardIdFromApi(memberCardIds, uid);
    if (fromApi && cardById.has(fromApi) && !isContactGroupCard(cardById.get(fromApi)!)) {
      if (!seenIds.has(fromApi)) {
        seenIds.add(fromApi);
        resolved.push(fromApi);
      }
      continue;
    }

    const byUid = cardByNormalizedUid.get(normalizeContactUidForMatch(uid));
    if (byUid && !isContactGroupCard(byUid) && !seenIds.has(byUid.id)) {
      seenIds.add(byUid.id);
      resolved.push(byUid.id);
    }
  }

  return resolved;
}

/** Groups from the sidebar universe that currently include this contact. */
export function groupsContainingCard(
  cardId: string,
  groups: ContactCard[],
  allCards: ContactCard[],
): ContactCard[] {
  if (!cardId) return [];
  return indexGroupMembershipByCardId(groups, allCards).get(cardId) ?? [];
}

/** One card-index pass, then membership lists keyed by contact id. */
export function indexGroupMembershipByCardId(
  groups: ContactCard[],
  allCards: ContactCard[],
): Map<string, ContactCard[]> {
  const indexes = cardIndexesFor(allCards);
  const byMember = new Map<string, ContactCard[]>();
  for (const group of groups) {
    for (const memberId of resolveGroupMemberCardIds(group, allCards, indexes)) {
      const existing = byMember.get(memberId);
      if (existing) existing.push(group);
      else byMember.set(memberId, [group]);
    }
  }
  return byMember;
}

/** Resolve group member uids to loaded contact cards (members + memberCardIds). */
export function resolveGroupMemberCards(
  groupCard: ContactCard,
  allCards: ContactCard[],
): ContactCard[] {
  const cardById = new Map(allCards.map((card) => [card.id, card]));
  return resolveGroupMemberCardIds(groupCard, allCards)
    .map((id) => cardById.get(id))
    .filter((card): card is ContactCard => card !== undefined);
}

/**
 * Rename/delete when the group lives in a writable book. No book ids falls
 * back to whether card operations exist (offline / story fixtures).
 */
export function canWriteContactGroup(
  group: Pick<ContactCard, "addressBookIds"> | null | undefined,
  addressBooks: readonly { id: string; myRights?: { mayWrite?: boolean } | null }[],
  hasOperations = false,
): boolean {
  if (!group) return false;
  const bookIds = Object.keys(group.addressBookIds ?? {});
  if (bookIds.length === 0) return hasOperations;
  return bookIds.some((bookId) => {
    const book = addressBooks.find((row) => row.id === bookId);
    return book?.myRights?.mayWrite !== false;
  });
}

/** PATCH body for renaming a group card (JSContact name.full). */
export function groupRenamePatch(name: string): ContactCardPatch {
  return {
    name: {
      "@type": "Name",
      isOrdered: false,
      full: name.trim(),
    },
  };
}

/**
 * Build a PATCH that adds contacts to a group's `members` map.
 * Filters out cards that are already members and group cards (no nesting).
 * Returns null when there is nothing new to add.
 */
export function groupAddMembersPatch(
  groupCard: ContactCard,
  cardsToAdd: ContactCard[],
): ContactCardPatch | null {
  const existingNormalizedUids = new Set(
    Object.entries(groupCard.members ?? {})
      .filter(([, enabled]) => Boolean(enabled))
      .map(([uid]) => normalizeContactUidForMatch(uid)),
  );

  const newMembers: Record<string, true> = {};
  for (const card of cardsToAdd) {
    if (!card.uid) continue;
    if (isContactGroupCard(card)) continue;
    if (!contactAndGroupShareAddressBook(card, groupCard)) continue;
    if (existingNormalizedUids.has(normalizeContactUidForMatch(card.uid))) continue;
    newMembers[memberUidForGroupMap(card.uid)] = true;
  }
  if (Object.keys(newMembers).length === 0) return null;
  return { members: newMembers };
}

function memberCardIdsOf(card: ContactCard): Record<string, string> {
  return { ...((card as ContactCardWithResolvedMembers).memberCardIds ?? {}) };
}

function stampMemberCardIds(group: ContactCard, members: ContactCard[]): Record<string, string> {
  const next = memberCardIdsOf(group);
  for (const member of members) {
    if (!member.uid) continue;
    next[memberUidForGroupMap(member.uid)] = member.id;
  }
  return next;
}

function enabledMemberUidSet(members: ContactCard["members"]): Set<string> {
  return new Set(enabledMemberUids(members).map((uid) => normalizeContactUidForMatch(uid)));
}

function memberSetsEqual(left: ContactCard["members"], right: ContactCard["members"]): boolean {
  const leftSet = enabledMemberUidSet(left);
  const rightSet = enabledMemberUidSet(right);
  if (leftSet.size !== rightSet.size) return false;
  for (const uid of leftSet) {
    if (!rightSet.has(uid)) return false;
  }
  return true;
}

/**
 * Keep local group membership when an incoming card (bootstrap get, patch
 * response) is still behind an optimistic add/remove.
 */
export function mergeGroupCardPreservingOptimisticMembers(
  incoming: ContactCard,
  local: ContactCard,
): ContactCard {
  if (!isContactGroupCard(local)) return incoming;
  if (memberSetsEqual(incoming.members, local.members)) {
    const incomingIds = (incoming as ContactCardWithResolvedMembers).memberCardIds;
    const localIds = (local as ContactCardWithResolvedMembers).memberCardIds;
    if (!incomingIds && !localIds) return incoming;
    return {
      ...incoming,
      members: incoming.members ?? local.members,
      memberCardIds: { ...localIds, ...incomingIds },
    } as ContactCard;
  }
  return {
    ...incoming,
    members: { ...incoming.members, ...local.members } as ContactCard["members"],
    memberCardIds: { ...memberCardIdsOf(incoming), ...memberCardIdsOf(local) },
  } as ContactCard;
}

/** Merge a bootstrap/list payload without dropping optimistic group members. */
export function mergeBootstrapCardsPreservingOptimistic(
  serverCards: ContactCard[],
  localCards: ContactCard[],
): ContactCard[] {
  if (serverCards === localCards) return localCards;
  const localById = new Map(localCards.map((card) => [card.id, card]));
  const merged = serverCards.map((server) => {
    const local = localById.get(server.id);
    return local ? mergeGroupCardPreservingOptimisticMembers(server, local) : server;
  });
  const serverIds = new Set(serverCards.map((card) => card.id));
  for (const local of localCards) {
    if (serverIds.has(local.id) || local.etag) continue;
    merged.push(local);
  }
  return merged;
}

/** Local/optimistic apply of {@link groupAddMembersPatch} onto a group card. */
export function cardWithAddedGroupMember(group: ContactCard, member: ContactCard): ContactCard {
  return cardWithAddedGroupMembers(group, [member]);
}

/** Local/optimistic apply of {@link groupAddMembersPatch} for one or more contacts. */
export function cardWithAddedGroupMembers(group: ContactCard, members: ContactCard[]): ContactCard {
  const patch = groupAddMembersPatch(group, members);
  if (!patch) return group;
  return {
    ...group,
    members: { ...group.members, ...patch.members } as ContactCard["members"],
    memberCardIds: stampMemberCardIds(group, members),
  } as ContactCard;
}

/** Insert or replace a card and add it to a group's members map when `groupId` is set. */
export function cardsWithGroupMember(
  list: ContactCard[],
  groupId: string | undefined,
  member: ContactCard,
): ContactCard[] {
  if (!groupId) return list;
  return list.map((card) => (card.id === groupId ? cardWithAddedGroupMember(card, member) : card));
}

/**
 * Build a PATCH that removes contacts from a group's `members` map.
 * Resolves card IDs to their member-map UIDs and sets those entries to false.
 * Returns null when none of the given card IDs are currently active members.
 */
export function groupRemoveMembersPatch(
  groupCard: ContactCard,
  cardIds: string[],
  allCards: ContactCard[],
): ContactCardPatch | null {
  if (!groupCard.members || cardIds.length === 0) return null;

  const cardById = new Map(allCards.map((card) => [card.id, card]));
  const cardByNormalizedUid = indexCardsByNormalizedUid(allCards);
  const memberCardIds = (groupCard as ContactCardWithResolvedMembers).memberCardIds;

  const removedMembers: Record<string, boolean> = {};
  for (const [uid, enabled] of Object.entries(groupCard.members)) {
    if (!enabled) continue;

    const fromApi = memberCardIdFromApi(memberCardIds, uid);
    let resolvedId: string | undefined;
    if (fromApi && cardById.has(fromApi)) {
      resolvedId = fromApi;
    } else {
      const byUid = cardByNormalizedUid.get(normalizeContactUidForMatch(uid));
      if (byUid) resolvedId = byUid.id;
    }

    if (resolvedId && cardIds.includes(resolvedId)) {
      removedMembers[uid] = false;
    }
  }

  if (Object.keys(removedMembers).length === 0) return null;
  return { members: removedMembers as ContactCardPatch["members"] };
}

/** Sidebar/list view key for a group card. */
export function contactsGroupViewKey(groupCardId: string): string {
  return `group:${groupCardId}`;
}

/** Hide cards whose every address book is unchecked in the sidebar (All Contacts). */
export function filterCardsByHiddenAddressBooks(
  cards: ContactCard[],
  hiddenBookIds: ReadonlySet<string>,
): ContactCard[] {
  if (hiddenBookIds.size === 0) return cards;
  return cards.filter((card) => {
    const bookIds = Object.entries(card.addressBookIds ?? {})
      .filter(([, on]) => Boolean(on))
      .map(([id]) => id);
    if (bookIds.length === 0) return true;
    return bookIds.some((id) => !hiddenBookIds.has(id));
  });
}

export function filterCardsByView(cards: ContactCard[], view: string): ContactCard[] {
  if (view.startsWith("group:")) {
    const groupId = view.slice("group:".length);
    const groupCard = cards.find((card) => card.id === groupId);
    if (!groupCard || !isContactGroupCard(groupCard)) return [];
    return resolveGroupMemberCards(groupCard, cards).sort((a, b) =>
      contactListSortName(a).localeCompare(contactListSortName(b), undefined, {
        sensitivity: "base",
      }),
    );
  }

  let scoped = cards;
  if (view.startsWith("book:")) {
    const bookId = view.slice("book:".length);
    scoped = cards.filter((card) => Boolean(card.addressBookIds?.[bookId]));
  }

  return scoped.filter((card) => !isContactGroupCard(card));
}
