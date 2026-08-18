import {
  addressBookChanges,
  connectedContacts,
  contactCardChanges,
  getAddressBook,
  getCard,
  isCannotCalculateChanges,
  listAddressBooks,
  listCards,
} from "@/lib/api/wgw/contacts";
import {
  listCachedAddressBookIds,
  readAddressBooksSyncToken,
  readSyncToken,
  removeAddressBookFromCache,
  removeContactCardFromCache,
  replaceAllAddressBooksInCache,
  upsertAddressBookInCache,
  upsertContactCardInCache,
  writeAddressBooksSyncToken,
  writeSyncToken,
} from "@/lib/offline/contacts-offline-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { contactsCardsTable } from "@/lib/offline/contacts/contacts-schema";

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
  const list = await listCards({ addressBookId, signal: opts?.signal });
  for (const card of list) {
    await upsertContactCardInCache(username, card, false);
  }
  await writeSyncToken(username, addressBookId, await currentTypeState("ContactCard"));
}

async function applyContactCardChanges(
  username: string,
  changes: JmapChangesResponse,
  opts?: { signal?: AbortSignal },
): Promise<void> {
  const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
  const cards = contactsCardsTable(db);
  for (const id of changes.destroyed) {
    const row = await cards.get(id);
    if (row?.pendingSync) continue;
    await removeContactCardFromCache(username, id);
  }
  const toFetch = [...changes.created, ...changes.updated];
  for (const id of toFetch) {
    const row = await cards.get(id);
    if (row?.pendingSync) continue;
    const card = await getCard(id, opts);
    await upsertContactCardInCache(username, card, false);
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
  await replaceAllAddressBooksInCache(username, books);
  await writeAddressBooksSyncToken(username, await currentTypeState("AddressBook"));
}

async function applyAddressBookChanges(
  username: string,
  changes: JmapChangesResponse,
  opts?: { signal?: AbortSignal },
): Promise<void> {
  for (const bookId of changes.destroyed) {
    await removeAddressBookFromCache(username, bookId);
  }
  for (const bookId of changes.created) {
    const book = await getAddressBook(bookId, opts);
    await upsertAddressBookInCache(username, book);
    await pullContactCardChangesForBook(username, bookId, opts);
  }
  for (const bookId of changes.updated) {
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
