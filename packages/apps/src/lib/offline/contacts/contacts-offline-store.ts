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
const META_DETAIL_PASS = "contacts:detailPass";

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

  const partialCardIds = (parseDetailPass((await db.meta.get(META_DETAIL_PASS))?.value) ?? {})
    .cardIds;
  return {
    session,
    data: {
      addressBooks: parseMirrorRows<AddressBook>(books),
      cards: parseMirrorRows<ContactCard>(cards),
    },
    ...(partialCardIds?.length ? { partialCardIds } : {}),
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
    const savedIds = (await cards.toCollection().primaryKeys()).map(String);
    await writePhotoPass(db, savedIds);
    // The pages were lean: every saved card is partial until its detail page is in.
    await writeDetailPass(db, savedIds);
    return true;
  });
}

/**
 * The photos still to fetch: the card ids a photo-less download left without
 * them, under the id of the pass that fetches them. A newer download installs
 * a new pass (new id); an older pass still running must then leave it alone.
 */
export type ContactsPhotoPass = { id: string; cardIds: string[] };

function parsePhotoPass(value: string | undefined): ContactsPhotoPass | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<ContactsPhotoPass> | null;
    if (!parsed || typeof parsed.id !== "string" || !Array.isArray(parsed.cardIds)) return null;
    const cardIds = parsed.cardIds.filter((id): id is string => typeof id === "string");
    return cardIds.length ? { id: parsed.id, cardIds } : null;
  } catch {
    return null;
  }
}

async function writePhotoPass(
  db: ReturnType<typeof offlineDbForAccount>,
  cardIds: string[],
): Promise<void> {
  if (cardIds.length === 0) {
    await db.meta.delete(META_PHOTO_PASS);
    return;
  }
  const pass: ContactsPhotoPass = { id: crypto.randomUUID(), cardIds };
  await db.meta.put({ key: META_PHOTO_PASS, value: JSON.stringify(pass) });
}

/** The photo pass still to run, or null when every photo is in. */
export async function readContactsPhotoPassRun(
  username: string,
): Promise<ContactsPhotoPass | null> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  return parsePhotoPass((await db.meta.get(META_PHOTO_PASS))?.value);
}

/** Card ids whose photos are still to fetch. Empty when there is nothing to fetch. */
export async function readContactsPhotoPass(username: string): Promise<string[]> {
  return (await readContactsPhotoPassRun(username))?.cardIds ?? [];
}

/**
 * A photo-less download replaced the copy: a new pass fetches the photos of
 * `cardIds` (those without one). It replaces any pass still running.
 */
export async function startContactsPhotoPass(username: string, cardIds: string[]): Promise<void> {
  await writePhotoPass(offlineDbForAccount(offlineAccountKeyFromUsername(username)), cardIds);
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
 * Saves one photo page of pass `passId` and the ids still to fetch, in one
 * transaction. A card takes the photos only when its stored version is the
 * one they came with: an older or newer stored card is left to the live sync,
 * which fetches it whole. Cards with unsynced local edits keep the local row.
 * The marker only moves while it still names this pass; when a newer pass has
 * replaced it, `superseded` tells the caller to stop and run that one.
 */
export async function saveContactsPhotoPage(
  username: string,
  passId: string,
  photos: ContactCardPhotos[],
  remainingCardIds: string[],
): Promise<{ changed: number; superseded: boolean }> {
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
    const current = parsePhotoPass((await db.meta.get(META_PHOTO_PASS))?.value);
    if (current?.id !== passId) return { changed: changed.length, superseded: true };
    if (remainingCardIds.length) {
      const pass: ContactsPhotoPass = { id: passId, cardIds: remainingCardIds };
      await db.meta.put({ key: META_PHOTO_PASS, value: JSON.stringify(pass) });
    } else {
      await db.meta.delete(META_PHOTO_PASS);
    }
    return { changed: changed.length, superseded: false };
  });
}

/**
 * The cards stored from a lean first download that are still partial (name,
 * emails and what the list needs; no phones, addresses or notes), under the
 * id of the pass that completes them. THE marker of partial cards: a card is
 * partial exactly while its id is listed, and a partial card must never be
 * edited or saved from its stored copy, since the save would drop every
 * field it lacks. A whole card from any source (the detail pass, opening the
 * card, live sync) removes its id.
 */
export type ContactsDetailPass = { id: string; cardIds: string[] };

function parseDetailPass(value: string | undefined): ContactsDetailPass | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<ContactsDetailPass> | null;
    if (!parsed || typeof parsed.id !== "string" || !Array.isArray(parsed.cardIds)) return null;
    const cardIds = parsed.cardIds.filter((id): id is string => typeof id === "string");
    return cardIds.length ? { id: parsed.id, cardIds } : null;
  } catch {
    return null;
  }
}

async function writeDetailPass(
  db: ReturnType<typeof offlineDbForAccount>,
  cardIds: string[],
  passId: string = crypto.randomUUID(),
): Promise<void> {
  if (cardIds.length === 0) {
    await db.meta.delete(META_DETAIL_PASS);
    return;
  }
  const pass: ContactsDetailPass = { id: passId, cardIds };
  await db.meta.put({ key: META_DETAIL_PASS, value: JSON.stringify(pass) });
}

/** The detail pass still to run, or null when every card is complete. */
export async function readContactsDetailPassRun(
  username: string,
): Promise<ContactsDetailPass | null> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  return parseDetailPass((await db.meta.get(META_DETAIL_PASS))?.value);
}

/** Ids of the partial cards (see {@link ContactsDetailPass}). Empty when all are complete. */
export async function readContactsPartialCardIds(username: string): Promise<string[]> {
  return (await readContactsDetailPassRun(username))?.cardIds ?? [];
}

/**
 * Installs a new detail pass for `cardIds` (replacing the running one), or
 * clears it with none: a full snapshot made every card complete.
 */
export async function startContactsDetailPass(username: string, cardIds: string[]): Promise<void> {
  await writeDetailPass(offlineDbForAccount(offlineAccountKeyFromUsername(username)), cardIds);
}

/** Takes `ids` off the partial list. Run inside a transaction on `db.meta`. */
async function markCardsComplete(
  db: ReturnType<typeof offlineDbForAccount>,
  ids: string[],
): Promise<void> {
  const current = parseDetailPass((await db.meta.get(META_DETAIL_PASS))?.value);
  if (!current) return;
  const done = new Set(ids);
  const left = current.cardIds.filter((id) => !done.has(id));
  if (left.length === current.cardIds.length) return;
  await writeDetailPass(db, left, current.id);
}

/**
 * Saves one detail page of pass `passId`, in one transaction. Only a card that
 * is still partial takes the page: a card a live sync or an open already made
 * whole is left alone, and a card with unsynced local edits keeps its local
 * row (and stays listed). The page's cards are whole but for `media`, which
 * the stored copy keeps. A card the stored copy lacks was deleted: it only
 * leaves the list. `superseded` tells the caller a newer pass replaced this
 * one (the page is saved anyway: it is valid for whichever pass lists the card).
 */
export async function saveContactsDetailPage(
  username: string,
  passId: string,
  cards: ContactCard[],
): Promise<{ changed: number; superseded: boolean }> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const table = contactsCardsTable(db);
  return db.transaction("rw", table, db.meta, async () => {
    const current = parseDetailPass((await db.meta.get(META_DETAIL_PASS))?.value);
    if (!current) return { changed: 0, superseded: true };
    const partial = new Set(current.cardIds);
    const rows = await table.bulkGet(cards.map((card) => card.id));
    const changed: OfflineContactCardRow[] = [];
    cards.forEach((card, index) => {
      if (!partial.has(card.id)) return;
      const row = rows[index];
      if (!row) {
        partial.delete(card.id);
        return;
      }
      if (row.pendingSync) return;
      const stored = JSON.parse(row.data) as ContactCard;
      changed.push(contactCardRow(stored.media ? { ...card, media: stored.media } : card, false));
      partial.delete(card.id);
    });
    if (changed.length) await table.bulkPut(changed);
    await writeDetailPass(db, [...partial], current.id);
    return { changed: changed.length, superseded: current.id !== passId };
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

/**
 * Stores `card`. The card is taken to be whole (from the server, or a create),
 * so it leaves the partial list; a caller that stores a card derived from a
 * stored partial copy passes `keepPartial`.
 */
export async function upsertContactCardInCache(
  username: string,
  card: ContactCard,
  pendingSync = false,
  options?: { keepPartial?: boolean },
): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const table = contactsCardsTable(db);
  if (options?.keepPartial) {
    await table.put(contactCardRow(card, pendingSync));
    return;
  }
  // One transaction: a detail page must not commit between the put and the
  // list update, or it would overwrite this card with an older copy.
  await db.transaction("rw", table, db.meta, async () => {
    await table.put(contactCardRow(card, pendingSync));
    await markCardsComplete(db, [card.id]);
  });
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
/**
 * Whether one card has unsynced local edits. A single read by id: the
 * `pendingSync` flag is a boolean, which IndexedDB cannot index, so listing
 * every pending id scans the whole table.
 */
export async function isContactCardPending(username: string, cardId: string): Promise<boolean> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const row = await contactsCardsTable(db).get(cardId);
  return row?.pendingSync === true;
}

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
