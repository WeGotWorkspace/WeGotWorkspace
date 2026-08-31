import type { ContactsAppBootstrap } from "@/lib/api/mock/contacts-bootstrap";
import { rememberOfflineContactsUsername } from "@/lib/offline/offline-session";
import type {
  AddressBook,
  ContactCard,
  ContactCardPatch,
} from "@/contacts-core/src/contacts-types";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import {
  isRetryableOutboxRow,
  listOutboxMutationsForDomain,
} from "@/lib/offline/core/outbox-store";
import { enqueueCoalescedOutboxUpdate } from "@/lib/offline/core/outbox-coalescing";
import type { OfflineOutboxRow } from "@/lib/offline/core/types";
import {
  CONTACTS_DOMAIN,
  contactsBooksTable,
  contactsCardsTable,
  type OfflineContactCardRow,
} from "@/lib/offline/contacts/contacts-schema";
import { coalesceContactPatches } from "@/lib/offline/contacts/contacts-patch-merge";

export {
  enqueueOutboxMutation,
  listOutboxMutations,
  markOutboxError,
  removeOutboxMutation,
} from "@/lib/offline/core/outbox-store";

const META_ADDRESS_BOOKS_STATE = "contacts:addressBooks:state";
const META_SESSION = "contacts:session";

function metaKeyForBookState(bookId: string): string {
  return `contacts:book:${bookId}:state`;
}

function contactCardRow(card: ContactCard, pendingSync: boolean): OfflineContactCardRow {
  const addressBookId =
    Object.keys(card.addressBookIds ?? {}).find((k) => card.addressBookIds?.[k]) ?? "default";
  return {
    id: card.id,
    addressBookId,
    data: JSON.stringify(card),
    pendingSync,
    updatedAt: Date.now(),
  };
}

export async function readContactsBootstrapFromCache(
  username: string,
): Promise<ContactsAppBootstrap | null> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const sessionRow = await db.meta.get(META_SESSION);
  if (!sessionRow?.value) return null;

  const books = await contactsBooksTable(db).toArray();
  const cards = await contactsCardsTable(db).toArray();
  if (books.length === 0 && cards.length === 0) return null;

  const session = JSON.parse(sessionRow.value) as ContactsAppBootstrap["session"];
  const addressBooks = books.map((row) => JSON.parse(row.data) as AddressBook);
  const contactCards = cards.map((row) => JSON.parse(row.data) as ContactCard);

  return {
    session,
    data: { addressBooks, cards: contactCards },
  };
}

export async function writeContactsBootstrapToCache(
  username: string,
  bootstrap: ContactsAppBootstrap,
): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const cards = contactsCardsTable(db);
  const books = contactsBooksTable(db);
  const pendingRows = await cards.filter((row) => row.pendingSync).toArray();
  await db.meta.put({ key: META_SESSION, value: JSON.stringify(bootstrap.session) });
  rememberOfflineContactsUsername(username);
  await books.clear();
  await books.bulkPut(
    bootstrap.data.addressBooks.map((book) => ({
      id: book.id ?? "default",
      data: JSON.stringify(book),
    })),
  );
  await cards.clear();
  await cards.bulkPut(bootstrap.data.cards.map((card) => contactCardRow(card, false)));
  if (pendingRows.length > 0) {
    await cards.bulkPut(pendingRows);
  }
}

export async function upsertContactCardInCache(
  username: string,
  card: ContactCard,
  pendingSync = false,
): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  await contactsCardsTable(db).put(contactCardRow(card, pendingSync));
}

export async function removeContactCardFromCache(username: string, cardId: string): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  await contactsCardsTable(db).delete(cardId);
}

/**
 * Outbox rows that failed for a transient (non-conflict) reason and can be
 * retried. Conflicts go to the resolution modal, not the retry callout.
 */
export async function listFailedContactOutbox(username: string): Promise<OfflineOutboxRow[]> {
  const rows = await listOutboxMutationsForDomain(username, CONTACTS_DOMAIN);
  return rows.filter(isRetryableOutboxRow);
}

/** Ids of cards with unsynced local changes (drives the pending-sync badge). */
export async function listPendingContactCardIds(username: string): Promise<string[]> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const rows = await contactsCardsTable(db)
    .filter((row) => row.pendingSync)
    .toArray();
  return rows.map((row) => row.id);
}

export async function readSyncToken(username: string, bookId: string): Promise<string | null> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const row = await db.meta.get(metaKeyForBookState(bookId));
  return row?.value ?? null;
}

export async function writeSyncToken(
  username: string,
  bookId: string,
  token: string,
): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  await db.meta.put({ key: metaKeyForBookState(bookId), value: token });
}

export async function readAddressBooksSyncToken(username: string): Promise<string | null> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const row = await db.meta.get(META_ADDRESS_BOOKS_STATE);
  return row?.value ?? null;
}

export async function writeAddressBooksSyncToken(username: string, token: string): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  await db.meta.put({ key: META_ADDRESS_BOOKS_STATE, value: token });
}

export async function upsertAddressBookInCache(username: string, book: AddressBook): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  await contactsBooksTable(db).put({
    id: book.id ?? "default",
    data: JSON.stringify(book),
  });
}

export async function removeAddressBookFromCache(username: string, bookId: string): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  await contactsBooksTable(db).delete(bookId);
  await db.meta.delete(metaKeyForBookState(bookId));
}

export async function readCachedAddressBooks(username: string): Promise<AddressBook[]> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const rows = await contactsBooksTable(db).toArray();
  return rows.map((row) => JSON.parse(row.data) as AddressBook);
}

export async function listCachedAddressBookIds(username: string): Promise<string[]> {
  const books = await readCachedAddressBooks(username);
  return books.map((book) => book.id).filter((id): id is string => Boolean(id && id.length > 0));
}

export async function listCachedCardsForAddressBook(
  username: string,
  addressBookId: string,
): Promise<OfflineContactCardRow[]> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  return contactsCardsTable(db).where("addressBookId").equals(addressBookId).toArray();
}

export async function replaceAllAddressBooksInCache(
  username: string,
  books: AddressBook[],
): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const table = contactsBooksTable(db);
  await table.clear();
  if (books.length === 0) return;
  await table.bulkPut(
    books.map((book) => ({
      id: book.id ?? "default",
      data: JSON.stringify(book),
    })),
  );
}

/** Card id targeted by an outbox row (update/delete `cardId`, or create `tempCardId`). */
export function contactsOutboxCardId(row: OfflineOutboxRow): string | null {
  if (row.domain !== CONTACTS_DOMAIN) return null;
  try {
    const payload = JSON.parse(row.payload) as {
      cardId?: string;
      tempCardId?: string;
      creationId?: string;
    };
    return payload.cardId ?? payload.tempCardId ?? payload.creationId ?? null;
  } catch {
    return null;
  }
}

/** Merges pending update rows for the same card so flush sends one patch with the original ifInState. */
export async function enqueueCoalescedContactUpdate(
  username: string,
  cardId: string,
  patch: ContactCardPatch,
  ifInState: string | undefined,
): Promise<void> {
  await enqueueCoalescedOutboxUpdate({
    username,
    domain: CONTACTS_DOMAIN,
    entityId: cardId,
    patch,
    ifInState,
    mergePatches: coalesceContactPatches,
    entityIdFromRow: contactsOutboxCardId,
    buildUpdatePayload: (entityId, mergedPatch) => ({ cardId: entityId, patch: mergedPatch }),
    readPatchFromPayload: (payload) => payload.patch as ContactCardPatch,
  });
}

export function createTempContactId(): string {
  return `local-${crypto.randomUUID().replace(/-/g, "")}`;
}
