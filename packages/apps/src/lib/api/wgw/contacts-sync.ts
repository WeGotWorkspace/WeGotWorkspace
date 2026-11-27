import type { ContactCard } from "@/lib/models/contacts-types";
import {
  addressBookChanges,
  connectedContacts,
  contactCardChanges,
  getAddressBook,
  getCard,
  getCards,
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
  ingestRemoteContactCardListedAway,
} from "@/lib/offline/contacts/contacts-jmap-inbound";
import {
  listCachedAddressBookIds,
  listPendingContactCardIds,
  readCachedContactCard,
  readAddressBooksSyncToken,
  readContactsBootstrapFromCache,
  readSyncToken,
  writeAddressBooksSyncToken,
  writeSyncToken,
} from "@/lib/offline/contacts/contacts-offline-store";
import { runScopedInbound, type ScopedInboundBinding } from "@/lib/offline/core/inbound-sync";
import { CONTACT_CARD_GET_MAX_IDS_PER_REQUEST } from "@/lib/jmap-client";

/** Envelope empty compose — REST used `"0"`, which cannotCalculateChanges. */
const INITIAL_JMAP_STATE = "0:";

type JmapChangesResponse = {
  oldState: string;
  newState: string;
  created: string[];
  updated: string[];
  destroyed: string[];
};

type CachedCardMembership = { id: string; scope: string };

/**
 * Contact cards through the shared inbound engine (#1565), one scope per
 * address book. `ContactCard/changes` is account-wide, so each book keeps its
 * own copy of the account's card state; a run fetches each changed card once.
 * A full list of a book (on `cannotCalculateChanges`) takes the cards it lacks
 * out of that book only, and deletes those left in no book.
 */
function contactCardsInbound(
  username: string,
  opts?: { signal?: AbortSignal },
): ScopedInboundBinding<ContactCard, CachedCardMembership> {
  let pending = new Set<string>();
  const readPending = async () => {
    pending = new Set(await listPendingContactCardIds(username));
  };
  // Changed cards are fetched a page at a time, not one request each: an
  // import of thousands of cards elsewhere would otherwise cost a request per
  // card. A page holds the next ids in the order `/changes` listed them, from
  // the id the run asks for. Every book shares the answers.
  const queued: string[] = [];
  const queuedAt = new Map<string, number>();
  const requested = new Set<string>();
  const fetched = new Map<string, ContactCard>();
  // A cached card a page left out: the server can still store it but not
  // return it (over the read size guard). Its row stays as it is.
  const keepCached = new WeakSet<ContactCard>();
  const queue = (changes: JmapChangesResponse) => {
    for (const id of [...changes.created, ...changes.updated]) {
      if (pending.has(id) || queuedAt.has(id)) continue;
      queuedAt.set(id, queued.length);
      queued.push(id);
    }
  };
  const fetchPageFrom = async (id: string) => {
    const page: string[] = [];
    for (let index = queuedAt.get(id) ?? 0; index < queued.length; index += 1) {
      const next = queued[index]!;
      if (requested.has(next)) continue;
      page.push(next);
      if (page.length === CONTACT_CARD_GET_MAX_IDS_PER_REQUEST) break;
    }
    const paced = requested.size > 0;
    for (const next of page) requested.add(next);
    for (const card of await getCards(page, { signal: opts?.signal, paced })) {
      fetched.set(card.id, card);
    }
  };
  return {
    // No token yet: changes since the empty state, as before (not a full list).
    readToken: async (bookId) => (await readSyncToken(username, bookId)) ?? INITIAL_JMAP_STATE,
    writeToken: (bookId, token) => writeSyncToken(username, bookId, token),
    changes: async (_bookId, since) => {
      const changes = await contactCardChanges(since, opts);
      queue(changes);
      return changes;
    },
    isCannotCalculateChanges,
    list: (bookId) => listCards({ addressBookId: bookId, signal: opts?.signal }),
    currentState: () => currentTypeState("ContactCard"),
    rowId: (card) => card.id,
    // A pending card is not fetched: its ingest only reports the conflict.
    fetch: async (id) => {
      if (pending.has(id)) return { id } as ContactCard;
      if (!queuedAt.has(id)) return getCard(id, opts);
      if (!requested.has(id)) await fetchPageFrom(id);
      const card = fetched.get(id);
      if (card) {
        // The engine asks for each id once; free the page as it is applied.
        fetched.delete(id);
        return card;
      }
      // Asked for and not returned. A card the cache lacks was deleted since its
      // change was listed. A cached one stays: a real delete is listed as
      // destroyed on the next run.
      if (!(await readCachedContactCard(username, id))) return null;
      const keep = { id } as ContactCard;
      keepCached.add(keep);
      return keep;
    },
    readCached: async () => {
      await readPending();
      const cached = await readContactsBootstrapFromCache(username);
      const items = (cached?.data.cards ?? []).flatMap((card) =>
        Object.entries(card.addressBookIds ?? {})
          .filter(([, included]) => card.id && included === true)
          .map(([bookId]) => ({ id: card.id, scope: bookId })),
      );
      return { items, keep: (item) => pending.has(item.id) };
    },
    scopeGone: {
      matches: isContactsNotFound,
      apply: (bookId) => ingestRemoteAddressBookDestroyed(username, bookId).then(() => {}),
    },
    createApplier: async () => {
      await readPending();
      return {
        ingest: (card) =>
          keepCached.has(card)
            ? Promise.resolve("skipped-pending" as const)
            : ingestRemoteContactCard(username, card),
        ingestDestroyed: (id) => ingestRemoteContactCardDestroyed(username, id),
        ingestListedAway: (id, bookId) => ingestRemoteContactCardListedAway(username, id, bookId),
        // Every run stores its state, as before: a skipped change of a pending
        // card goes to the conflict dialog, not to the next run.
        blocksToken: new Set<string>(),
      };
    },
  };
}

async function syncContactCardScopes(
  username: string,
  addressBookIds: readonly string[],
  opts?: { signal?: AbortSignal },
): Promise<void> {
  await runScopedInbound(addressBookIds, contactCardsInbound(username, opts));
}

export async function pullContactCardChangesForBook(
  username: string,
  addressBookId: string,
  opts?: { signal?: AbortSignal },
): Promise<void> {
  await syncContactCardScopes(username, [addressBookId], opts);
}

async function currentTypeState(type: "AddressBook" | "ContactCard"): Promise<string> {
  const { client, accountId } = await connectedContacts();
  return client.getState(accountId, type) ?? INITIAL_JMAP_STATE;
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
  const changedBookIds = [...changes.created, ...changes.updated];
  for (const bookId of changedBookIds) {
    const book = await getAddressBook(bookId, opts);
    await ingestRemoteAddressBook(username, book);
  }
  // One run for every changed book: a card that moved between two books is
  // named by both, and is fetched once instead of once per book.
  if (changedBookIds.length > 0) await syncContactCardScopes(username, changedBookIds, opts);
}

export async function syncAllContactBooks(
  username: string,
  addressBookIds: string[],
  opts?: { signal?: AbortSignal },
): Promise<void> {
  await syncContactCardScopes(username, addressBookIds, opts);
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
