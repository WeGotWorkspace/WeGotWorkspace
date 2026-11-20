import type { ContactsAppBootstrap } from "@/lib/api/mock/contacts-bootstrap";
import { rememberOfflineContactsUsername } from "@/lib/offline/core/offline-session";
import type { AddressBook, ContactCard, ContactCardPatch } from "@/lib/models/contacts-types";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import {
  parseMirrorRows,
  readMirrorSession,
  replaceMirrorRows,
  writeMirrorSession,
} from "@/lib/offline/core/mirror-cache";
import {
  isSyncNoticeOutboxRow,
  listOutboxMutationsForDomain,
} from "@/lib/offline/core/outbox-store";
import { enqueueCoalescedOutboxUpdate } from "@/lib/offline/core/outbox-coalescing";
import { createLocalEntityId, outboxEntityIdReader } from "@/lib/offline/core/outbox-entity-id";
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
const META_COLD_DOWNLOAD = "contacts:coldDownload";
const META_PHOTO_PASS = "contacts:photoPass";

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
  const session = await readMirrorSession<ContactsAppBootstrap["session"]>(db, META_SESSION);
  if (!session) return null;

  const books = await contactsBooksTable(db).toArray();
  const cards = await contactsCardsTable(db).toArray();
  if (books.length === 0 && cards.length === 0) return null;

  return {
    session,
    data: {
      addressBooks: parseMirrorRows<AddressBook>(books),
      cards: parseMirrorRows<ContactCard>(cards),
    },
  };
}

/**
 * Replaces the stored copy with `bootstrap` in one transaction, so a closed
 * tab never leaves the books written and the cards cleared. Rows with unsynced
 * local edits stay.
 */
export async function writeContactsBootstrapToCache(
  username: string,
  bootstrap: ContactsAppBootstrap,
): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const cards = contactsCardsTable(db);
  const books = contactsBooksTable(db);
  rememberOfflineContactsUsername(username);
  await db.transaction("rw", cards, books, db.meta, async () => {
    await writeMirrorSession(db, META_SESSION, bootstrap.session);
    await replaceMirrorRows(
      books,
      bootstrap.data.addressBooks.map((book) => ({
        id: book.id ?? "default",
        data: JSON.stringify(book),
      })),
    );
    await replaceMirrorRows(
      cards,
      bootstrap.data.cards.map((card) => contactCardRow(card, false)),
    );
  });
}

/**
 * A first download that has not finished. While this row exists the stored
 * copy is partial: boot fetches `remainingCardIds`, and only then stores the
 * query-time states as sync tokens (so `/changes` replays every change made
 * since the query, including on cards saved early). `id` names the download
 * that owns the row: only that download may save pages into it or finish it.
 */
export type ContactsColdDownload = {
  id: string;
  addressBookState: string;
  contactCardState: string;
  /** Card ids from the query that are not saved yet. */
  remainingCardIds: string[];
  /**
   * Group card ids from the query, so a resume can show All Contacts' total
   * from the start. Null (or missing) when the server cannot tell groups apart.
   */
  groupIds?: string[] | null;
};

function parseColdDownload(value: string | undefined): ContactsColdDownload | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as ContactsColdDownload;
  } catch {
    return null;
  }
}

export async function readContactsColdDownload(
  username: string,
): Promise<ContactsColdDownload | null> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  return parseColdDownload((await db.meta.get(META_COLD_DOWNLOAD))?.value);
}

/**
 * True when a session and at least one book or card are stored: the same rule
 * {@link readContactsBootstrapFromCache} uses, without parsing every row.
 */
export async function hasContactsCopy(username: string): Promise<boolean> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  if (!(await db.meta.get(META_SESSION))?.value) return false;
  return (await contactsBooksTable(db).count()) + (await contactsCardsTable(db).count()) > 0;
}

/**
 * Marks the copy unfinished, then stores the session and books with no cards
 * yet. The marker goes first: a copy without it counts as complete. Only for a
 * device with no copy; an unfinished copy is resumed, never restarted.
 */
export async function startContactsColdDownload(
  username: string,
  session: ContactsAppBootstrap["session"],
  addressBooks: AddressBook[],
  progress: ContactsColdDownload,
): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  await db.meta.put({ key: META_COLD_DOWNLOAD, value: JSON.stringify(progress) });
  await writeContactsBootstrapToCache(username, { session, data: { addressBooks, cards: [] } });
}

/**
 * Saves one page and the ids still missing in one transaction. A card with
 * unsynced local edits keeps the local row. Returns the cards it saved, or
 * null when download `downloadId` no longer owns the marker (finished, or
 * taken over by another download); nothing is written then.
 */
export async function saveContactsColdDownloadPage(
  username: string,
  downloadId: string,
  cards: ContactCard[],
  remainingCardIds: string[],
): Promise<ContactCard[] | null> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const table = contactsCardsTable(db);
  return db.transaction("rw", table, db.meta, async () => {
    const progress = parseColdDownload((await db.meta.get(META_COLD_DOWNLOAD))?.value);
    if (!progress || progress.id !== downloadId) return null;
    const existing = await table.bulkGet(cards.map((card) => card.id));
    const fresh = cards.filter((_, index) => !existing[index]?.pendingSync);
    await table.bulkPut(fresh.map((card) => contactCardRow(card, false)));
    await db.meta.put({
      key: META_COLD_DOWNLOAD,
      value: JSON.stringify({ ...progress, remainingCardIds }),
    });
    return fresh;
  });
}

/**
 * Last step of download `downloadId`: stores its query-time states as the
 * sync tokens for `bookIds` and removes the marker, in one transaction.
 * Returns false (and writes nothing) when another download owns the marker.
 */
export async function finishContactsColdDownload(
  username: string,
  downloadId: string,
  bookIds: string[],
): Promise<boolean> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const cards = contactsCardsTable(db);
  return db.transaction("rw", cards, db.meta, async () => {
    const progress = parseColdDownload((await db.meta.get(META_COLD_DOWNLOAD))?.value);
    if (!progress || progress.id !== downloadId) return false;
    await db.meta.put({ key: META_ADDRESS_BOOKS_STATE, value: progress.addressBookState });
    for (const bookId of bookIds) {
      await db.meta.put({ key: metaKeyForBookState(bookId), value: progress.contactCardState });
    }
    await db.meta.delete(META_COLD_DOWNLOAD);
    // The pages were photo-less: every saved card still needs its photo.
    await db.meta.put({
      key: META_PHOTO_PASS,
      value: JSON.stringify((await cards.toCollection().primaryKeys()).map(String)),
    });
    return true;
  });
}

/**
 * Card ids whose photos a photo-less download left out and the photo pass has
 * not fetched yet. Empty when there is nothing to fetch.
 */
export async function readContactsPhotoPass(username: string): Promise<string[]> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const value = (await db.meta.get(META_PHOTO_PASS))?.value;
  if (!value) return [];
  try {
    const ids = JSON.parse(value) as unknown;
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** A photo-less download replaced the copy: fetch the photos of `cardIds`. */
export async function startContactsPhotoPass(username: string, cardIds: string[]): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  await db.meta.put({ key: META_PHOTO_PASS, value: JSON.stringify(cardIds) });
}

/**
 * A photo-less download over a stored copy: cards keep the photos stored for
 * the same version of the card until the photo pass refreshes them, so the
 * list does not drop to initials meanwhile.
 */
export async function withStoredPhotos(
  username: string,
  cards: ContactCard[],
): Promise<ContactCard[]> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const rows = await contactsCardsTable(db).bulkGet(cards.map((card) => card.id));
  return cards.map((card, index) => {
    const row = rows[index];
    if (card.media || !row) return card;
    const stored = JSON.parse(row.data) as ContactCard;
    return stored.media && stored.state && stored.state === card.state
      ? { ...card, media: stored.media }
      : card;
  });
}

/** What the photo pass fetches per card: its photos and the version they belong to. */
export type ContactCardPhotos = Pick<ContactCard, "id" | "media" | "state">;

/**
 * Saves one photo page and the ids still to fetch, in one transaction. A card
 * takes the photos only when its stored version is the one they came with:
 * an older or newer stored card is left to the live sync, which fetches it
 * whole. Cards with unsynced local edits keep the local row. Returns how many
 * cards changed.
 */
export async function saveContactsPhotoPage(
  username: string,
  photos: ContactCardPhotos[],
  remainingCardIds: string[],
): Promise<number> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const table = contactsCardsTable(db);
  return db.transaction("rw", table, db.meta, async () => {
    const rows = await table.bulkGet(photos.map((entry) => entry.id));
    const changed: OfflineContactCardRow[] = [];
    photos.forEach((entry, index) => {
      const row = rows[index];
      if (!row || row.pendingSync) return;
      const card = JSON.parse(row.data) as ContactCard;
      if (!entry.state || card.state !== entry.state || !entry.media) return;
      changed.push(contactCardRow({ ...card, media: entry.media }, false));
    });
    if (changed.length) await table.bulkPut(changed);
    if (remainingCardIds.length) {
      await db.meta.put({ key: META_PHOTO_PASS, value: JSON.stringify(remainingCardIds) });
    } else {
      await db.meta.delete(META_PHOTO_PASS);
    }
    return changed.length;
  });
}

/** A full snapshot replaced the copy: whatever download was unfinished is done. */
export async function discardContactsColdDownload(username: string): Promise<boolean> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  return db.transaction("rw", db.meta, async () => {
    if (!(await db.meta.get(META_COLD_DOWNLOAD))) return false;
    await db.meta.delete(META_COLD_DOWNLOAD);
    return true;
  });
}

/** True when contact edits are waiting in the outbox. */
export async function hasQueuedContactEdits(username: string): Promise<boolean> {
  const rows = await listOutboxMutationsForDomain(username, CONTACTS_DOMAIN);
  return rows.length > 0;
}

export async function upsertContactCardInCache(
  username: string,
  card: ContactCard,
  pendingSync = false,
): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  await contactsCardsTable(db).put(contactCardRow(card, pendingSync));
}

/** One cached card, or null when the cache does not have it. */
export async function readCachedContactCard(
  username: string,
  cardId: string,
): Promise<ContactCard | null> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const row = await contactsCardsTable(db).get(cardId);
  return row ? (JSON.parse(row.data) as ContactCard) : null;
}

export async function removeContactCardFromCache(username: string, cardId: string): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  await contactsCardsTable(db).delete(cardId);
}

/**
 * Undo of a create that is still queued: drop the create and every row queued for the
 * same temporary card, plus the cached card, in one transaction. Returns false when no
 * create is queued for `cardId` (the card is on the server: delete it there).
 */
export async function dropQueuedContactCreate(username: string, cardId: string): Promise<boolean> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  return db.transaction("rw", [db.outbox, contactsCardsTable(db)], async () => {
    const rows = await db.outbox.where("domain").equals(CONTACTS_DOMAIN).toArray();
    const queued = rows.filter((row) => contactsOutboxCardId(row) === cardId);
    if (!queued.some((row) => row.op === "create")) return false;
    await db.outbox.bulkDelete(queued.map((row) => row.id));
    await contactsCardsTable(db).delete(cardId);
    return true;
  });
}

/**
 * Outbox rows the retry callout lists: transient failures and permanent
 * 403/404 rejections. Conflicts go to the resolution modal, not this list.
 */
export async function listFailedContactOutbox(username: string): Promise<OfflineOutboxRow[]> {
  const rows = await listOutboxMutationsForDomain(username, CONTACTS_DOMAIN);
  return rows.filter(isSyncNoticeOutboxRow);
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
export const contactsOutboxCardId = outboxEntityIdReader(CONTACTS_DOMAIN, [
  "cardId",
  "tempCardId",
  "creationId",
]);

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
  return createLocalEntityId();
}
