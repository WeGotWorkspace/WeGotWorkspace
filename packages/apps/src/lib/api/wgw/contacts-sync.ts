import type { ContactCard } from "@/contacts-core/src/contacts-types";
import {
  addressBookChanges,
  connectedContacts,
  contactCardChanges,
  getAddressBook,
  getCard,
  isCannotCalculateChanges,
  isContactsNotFound,
  listAddressBooks,
  listCards,
} from "@/lib/api/wgw/contacts";
import {
  ingestRemoteAddressBook,
  ingestRemoteAddressBookDestroyed,
  ingestRemoteContactCard,
  ingestRemoteContactCardDestroyed,
} from "@/lib/offline/contacts-jmap-inbound";
import {
  listCachedAddressBookIds,
  listPendingContactCardIds,
  readAddressBooksSyncToken,
  readSyncToken,
  writeAddressBooksSyncToken,
  writeSyncToken,
} from "@/lib/offline/contacts-offline-store";

/** Envelope empty compose — REST used `"0"`, which cannotCalculateChanges. */
const INITIAL_JMAP_STATE = "0:";

type JmapChangesResponse = {
  oldState: string;
  newState: string;
  created: string[];
  updated: string[];
  destroyed: string[];
};

export async function pullContactCardChangesForBook(
  username: string,
  addressBookId: string,
  opts?: { signal?: AbortSignal },
): Promise<void> {
  const since = (await readSyncToken(username, addressBookId)) ?? INITIAL_JMAP_STATE;
  try {
    const changes = await contactCardChanges(since, opts);
    await applyContactCardChanges(username, changes, opts);
    await writeSyncToken(username, addressBookId, changes.newState);
  } catch (error) {
    if (isCannotCalculateChanges(error)) {
      await fullResyncBook(username, addressBookId, opts);
      return;
    }
    if (isContactsNotFound(error)) {
      await ingestRemoteAddressBookDestroyed(username, addressBookId);
      return;
    }
    throw error;
  }
}

async function currentTypeState(type: "AddressBook" | "ContactCard"): Promise<string> {
  const { client, accountId } = await connectedContacts();
  return client.getState(accountId, type) ?? INITIAL_JMAP_STATE;
}

async function fullResyncBook(
  username: string,
  addressBookId: string,
  opts?: { signal?: AbortSignal },
): Promise<void> {
  try {
    const list = await listCards({ addressBookId, signal: opts?.signal });
    for (const card of list) {
      await ingestRemoteContactCard(username, card);
    }
    await writeSyncToken(username, addressBookId, await currentTypeState("ContactCard"));
  } catch (error) {
    if (isContactsNotFound(error)) {
      await ingestRemoteAddressBookDestroyed(username, addressBookId);
      return;
    }
    throw error;
  }
}

async function applyContactCardChanges(
  username: string,
  changes: JmapChangesResponse,
  opts?: { signal?: AbortSignal },
): Promise<void> {
  const pending = new Set(await listPendingContactCardIds(username));
  for (const id of changes.destroyed) {
    await ingestRemoteContactCardDestroyed(username, id);
  }
  const toFetch = [...changes.created, ...changes.updated];
  for (const id of toFetch) {
    if (pending.has(id)) {
      await ingestRemoteContactCard(username, { id } as ContactCard);
      continue;
    }
    const card = await getCard(id, opts);
    await ingestRemoteContactCard(username, card);
  }
}

export async function pullAddressBookChanges(
  username: string,
  opts?: { signal?: AbortSignal },
): Promise<void> {
  const since = (await readAddressBooksSyncToken(username)) ?? INITIAL_JMAP_STATE;
  try {
    const changes = await addressBookChanges(since, opts);
    await applyAddressBookChanges(username, changes, opts);
    await writeAddressBooksSyncToken(username, changes.newState);
  } catch (error) {
    if (isCannotCalculateChanges(error)) {
      await fullResyncAddressBooks(username, opts);
      return;
    }
    throw error;
  }
}

async function fullResyncAddressBooks(
  username: string,
  opts?: { signal?: AbortSignal },
): Promise<void> {
  const books = await listAddressBooks(opts);
  const remoteIds = new Set(books.map((book) => book.id).filter(Boolean));
  for (const book of books) {
    await ingestRemoteAddressBook(username, book);
  }
  const cachedIds = await listCachedAddressBookIds(username);
  for (const bookId of cachedIds) {
    if (remoteIds.has(bookId)) continue;
    await ingestRemoteAddressBookDestroyed(username, bookId);
  }
  await writeAddressBooksSyncToken(username, await currentTypeState("AddressBook"));
}

async function applyAddressBookChanges(
  username: string,
  changes: JmapChangesResponse,
  opts?: { signal?: AbortSignal },
): Promise<void> {
  for (const bookId of changes.destroyed) {
    await ingestRemoteAddressBookDestroyed(username, bookId);
  }
  for (const bookId of changes.created) {
    const book = await getAddressBook(bookId, opts);
    await ingestRemoteAddressBook(username, book);
    await pullContactCardChangesForBook(username, bookId, opts);
  }
  for (const bookId of changes.updated) {
    const book = await getAddressBook(bookId, opts);
    await ingestRemoteAddressBook(username, book);
    await pullContactCardChangesForBook(username, bookId, opts);
  }
}

export async function syncAllContactBooks(
  username: string,
  addressBookIds: string[],
  opts?: { signal?: AbortSignal },
): Promise<void> {
  for (const bookId of addressBookIds) {
    await pullContactCardChangesForBook(username, bookId, opts);
  }
}

export async function syncContactBooksAfterAddressBookChanges(
  username: string,
  opts?: { signal?: AbortSignal },
): Promise<void> {
  await pullAddressBookChanges(username, opts);
  const bookIds = await listCachedAddressBookIds(username);
  if (bookIds.length > 0) {
    await syncAllContactBooks(username, bookIds, opts);
  }
}
