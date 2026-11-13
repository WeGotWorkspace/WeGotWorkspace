import type { AddressBook, ContactCard } from "@/lib/models/contacts-types";
import {
  listCachedCardsForAddressBook,
  listPendingContactCardIds,
  readCachedContactCard,
  readContactsBootstrapFromCache,
  removeAddressBookFromCache,
  removeContactCardFromCache,
  upsertAddressBookInCache,
  upsertContactCardInCache,
} from "@/lib/offline/contacts/contacts-offline-store";
import { reportContactsSyncConflicts } from "@/lib/offline/contacts/contacts-sync-conflicts";

async function pendingSet(username: string): Promise<Set<string>> {
  return new Set(await listPendingContactCardIds(username));
}

/**
 * Ingest a remote card into Dexie. Pending outbox / pendingSync rows are
 * not overwritten; a clash still goes through `reportContactsSyncConflicts`.
 */
export async function ingestRemoteContactCard(
  username: string,
  card: ContactCard,
): Promise<"upserted" | "skipped-pending"> {
  if (!card.id) return "skipped-pending";
  const pending = await pendingSet(username);
  if (pending.has(card.id)) {
    reportContactsSyncConflicts([card.id]);
    return "skipped-pending";
  }
  await upsertContactCardInCache(username, card, false);
  return "upserted";
}

/** Drop a remotely destroyed card unless a local pending write still owns the id. */
export async function ingestRemoteContactCardDestroyed(
  username: string,
  cardId: string,
): Promise<"removed" | "skipped-pending"> {
  const pending = await pendingSet(username);
  if (pending.has(cardId)) {
    reportContactsSyncConflicts([cardId]);
    return "skipped-pending";
  }
  await removeContactCardFromCache(username, cardId);
  return "removed";
}

/** Upsert a remote address book into the Dexie book list. */
export async function ingestRemoteAddressBook(
  username: string,
  book: AddressBook,
): Promise<"upserted"> {
  await upsertAddressBookInCache(username, book);
  return "upserted";
}

/**
 * Drop a remotely destroyed address book and its cached cards. Pending outbox
 * card rows stay so flush/conflict handling can run.
 */
export async function ingestRemoteAddressBookDestroyed(
  username: string,
  addressBookId: string,
): Promise<"removed"> {
  const pending = await pendingSet(username);
  const rows = await listCachedCardsForAddressBook(username, addressBookId);
  const conflicts: string[] = [];
  for (const row of rows) {
    if (pending.has(row.id)) {
      conflicts.push(row.id);
      continue;
    }
    await removeContactCardFromCache(username, row.id);
  }
  if (conflicts.length > 0) {
    reportContactsSyncConflicts(conflicts);
  }
  await removeAddressBookFromCache(username, addressBookId);
  return "removed";
}

/**
 * Full snapshot after cannotCalculateChanges: upsert remote rows, then drop
 * local books/cards that are gone (pending card writes stay).
 */
export async function reconcileContactsSnapshot(
  username: string,
  cards: ContactCard[],
  books: AddressBook[],
): Promise<void> {
  const pending = await pendingSet(username);
  const cached = await readContactsBootstrapFromCache(username);
  const remoteCardIds = new Set(cards.map((card) => card.id).filter(Boolean));
  const remoteBookIds = new Set(books.map((book) => book.id).filter(Boolean));

  for (const book of books) {
    await ingestRemoteAddressBook(username, book);
  }
  for (const card of cards) {
    await ingestRemoteContactCard(username, card);
  }
  for (const card of cached?.data.cards ?? []) {
    if (!card.id || remoteCardIds.has(card.id) || pending.has(card.id)) continue;
    await removeContactCardFromCache(username, card.id);
  }
  for (const book of cached?.data.addressBooks ?? []) {
    if (!book.id || remoteBookIds.has(book.id)) continue;
    await removeAddressBookFromCache(username, book.id);
  }
}

/**
 * A card the full list of one address book lacks: it left that book. A card
 * that still belongs to another book stays with that membership; a card left
 * with no book is deleted. A pending local write is left untouched. True when
 * the cache changed.
 */
export async function ingestRemoteContactCardListedAway(
  username: string,
  cardId: string,
  addressBookId: string,
): Promise<boolean> {
  const pending = await pendingSet(username);
  if (pending.has(cardId)) return false;
  const card = await readCachedContactCard(username, cardId);
  const membership = { ...(card?.addressBookIds ?? {}) };
  if (!card || membership[addressBookId] !== true) return false;
  delete membership[addressBookId];
  if (Object.values(membership).some((included) => included === true)) {
    await upsertContactCardInCache(username, { ...card, addressBookIds: membership });
  } else {
    await removeContactCardFromCache(username, cardId);
  }
  return true;
}
