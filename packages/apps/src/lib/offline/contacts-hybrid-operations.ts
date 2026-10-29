import type {
  AddressBook,
  AddressBookMutationPatch,
  ContactCard,
  ContactCardCreate,
  ContactCardPatch,
  ContactsAPIOperations,
  ContactsMutationOpts,
} from "@/contacts-core/src/contacts-types";
import {
  fetchContactCardPages,
  fetchContactsLiveBootstrap,
} from "@/lib/api/wgw/contacts-bootstrap";
import {
  createCardWithState,
  deleteCardWithState,
  patchCardWithState,
} from "@/lib/api/wgw/contacts-mutations";
import { contactCardToVCard } from "@/contacts-core/src/contacts-vcard-export";
import {
  connectedContacts,
  getCard,
  importVcards,
  listAddressBooks,
  listCards,
  patchAddressBook,
  type ContactsBootstrapSyncAnchor,
} from "@/lib/api/wgw/contacts";
import { syncContactBooksAfterAddressBookChanges } from "@/lib/api/wgw/contacts-sync";
import { isFetchNetworkError, readBrowserOnline } from "@/lib/offline/browser-online";
import { applyContactPatch } from "@/lib/offline/contacts/contacts-patch-merge";
import type { ContactsAppBootstrap } from "@/lib/api/mock/contacts-bootstrap";
import {
  createTempContactId,
  enqueueCoalescedContactUpdate,
  enqueueOutboxMutation,
  finishContactsColdDownload,
  hasContactsCopy,
  readCachedAddressBooks,
  readContactsBootstrapFromCache,
  readContactsColdDownload,
  removeContactCardFromCache,
  saveContactsColdDownloadPage,
  startContactsColdDownload,
  type ContactsColdDownload,
  upsertAddressBookInCache,
  upsertContactCardInCache,
  writeAddressBooksSyncToken,
  writeContactsBootstrapToCache,
  writeSyncToken,
} from "@/lib/offline/contacts-offline-store";
import { CONTACTS_DOMAIN } from "@/lib/offline/contacts/contacts-schema";
import { flushContactsOutbox, type OutboxFlushResult } from "@/lib/offline/contacts-outbox-flush";
import { reportContactsSyncConflicts } from "@/lib/offline/contacts-sync-conflicts";
import { readOfflineContactsUsername } from "@/lib/offline/offline-session";
import {
  ConnectivitySyncRunner,
  ConnectivitySyncRunnerRegistry,
} from "@/lib/offline/core/connectivity-sync-runner";

function concurrencyToken(card: ContactCard, opts?: ContactsMutationOpts): string | undefined {
  const state = (card as ContactCard & { state?: string }).state;
  return opts?.ifInState ?? state;
}

function rethrowUnlessOfflineQueue(error: unknown, opts?: ContactsMutationOpts): void {
  if (opts?.signal?.aborted) throw error;
  if (error instanceof DOMException && error.name === "AbortError") throw error;
  if (!isFetchNetworkError(error)) throw error;
}

const syncRunnerRegistry = new ConnectivitySyncRunnerRegistry<OutboxFlushResult>(CONTACTS_DOMAIN);

async function flushContactsOutboxAndReport(username: string): Promise<OutboxFlushResult> {
  const result = await flushContactsOutbox(username);
  reportContactsSyncConflicts(result.stateMismatches);
  return result;
}

function runnerFor(username: string): ConnectivitySyncRunner<OutboxFlushResult> {
  return syncRunnerRegistry.getOrCreate(username, async () =>
    flushContactsOutboxAndReport(username),
  );
}

async function resolveCachedCard(
  username: string,
  cardId: string,
  opts?: ContactsMutationOpts,
): Promise<ContactCard | undefined> {
  const cached = await readContactsBootstrapFromCache(username);
  const fromCache = cached?.data.cards.find((c) => c.id === cardId);
  if (fromCache || !readBrowserOnline()) return fromCache;

  try {
    return await getCard(cardId, opts);
  } catch (error) {
    if (isFetchNetworkError(error)) return fromCache;
    throw error;
  }
}

async function queueOfflineCreate(username: string, body: ContactCardCreate): Promise<ContactCard> {
  const tempId = createTempContactId();
  const optimistic = {
    ...body,
    id: tempId,
    "@type": "Card",
    version: "1.0",
    uid: body.uid ?? `urn:uuid:${crypto.randomUUID()}`,
    state: `local-state-${tempId}`,
  } as ContactCard;
  await upsertContactCardInCache(username, optimistic, true);
  await enqueueOutboxMutation(username, {
    id: crypto.randomUUID(),
    domain: CONTACTS_DOMAIN,
    op: "create",
    payload: JSON.stringify({
      creationId: tempId,
      tempCardId: tempId,
      body,
    }),
  });
  return optimistic;
}

async function queueOfflinePatch(
  username: string,
  cardId: string,
  patch: ContactCardPatch,
  existing: ContactCard,
  opts?: ContactsMutationOpts,
): Promise<ContactCard> {
  const token = concurrencyToken(existing, opts);
  const optimistic = applyContactPatch(existing, patch);
  await upsertContactCardInCache(username, optimistic, true);
  await enqueueCoalescedContactUpdate(username, cardId, patch, token);
  return optimistic;
}

async function queueOfflineDelete(
  username: string,
  cardId: string,
  token: string | undefined,
): Promise<void> {
  await removeContactCardFromCache(username, cardId);
  await enqueueOutboxMutation(username, {
    id: crypto.randomUUID(),
    domain: CONTACTS_DOMAIN,
    op: "delete",
    payload: JSON.stringify({ cardId }),
    ifInState: token,
  });
}

function applyAddressBookPatch(
  existing: AddressBook,
  patch: AddressBookMutationPatch,
): AddressBook {
  return {
    ...existing,
    ...(patch.isSubscribed !== undefined ? { isSubscribed: patch.isSubscribed } : {}),
    ...(patch.shareWith !== undefined ? { shareWith: patch.shareWith } : {}),
  };
}

async function queueOfflineBookUpdate(
  username: string,
  addressBookId: string,
  patch: AddressBookMutationPatch,
): Promise<AddressBook> {
  const books = await readCachedAddressBooks(username);
  const existing = books.find((book) => book.id === addressBookId);
  if (!existing) {
    throw new Error("Address book not found in cache while offline");
  }
  const updated = applyAddressBookPatch(existing, patch);
  await upsertAddressBookInCache(username, updated);
  await enqueueOutboxMutation(username, {
    id: crypto.randomUUID(),
    domain: CONTACTS_DOMAIN,
    op: "bookUpdate",
    payload: JSON.stringify({ addressBookId, patch }),
  });
  return updated;
}

export function createHybridContactsOperations(username: string): ContactsAPIOperations {
  const runner = runnerFor(username);

  return {
    listAddressBooks: async (opts) => {
      const cached = await readContactsBootstrapFromCache(username);
      if (cached && !readBrowserOnline()) {
        return cached.data.addressBooks;
      }
      return listAddressBooks(opts);
    },
    listCards: async (opts) => {
      const cached = await readContactsBootstrapFromCache(username);
      if (cached && !readBrowserOnline()) {
        if (opts?.addressBookId) {
          const bookId = opts.addressBookId;
          return cached.data.cards.filter((c) => Boolean(c.addressBookIds?.[bookId]));
        }
        return cached.data.cards;
      }
      return listCards(opts);
    },
    getCard: async (cardId, opts) => {
      const cached = await readContactsBootstrapFromCache(username);
      if (cached && !readBrowserOnline()) {
        const found = cached.data.cards.find((c) => c.id === cardId);
        if (found) return found;
      }
      return getCard(cardId, opts);
    },
    createCard: async (body, opts) => {
      if (!readBrowserOnline()) {
        return queueOfflineCreate(username, body);
      }
      try {
        const card = await createCardWithState(body, opts);
        await upsertContactCardInCache(username, card, false);
        await runner.flush();
        return card;
      } catch (error) {
        rethrowUnlessOfflineQueue(error, opts);
        return queueOfflineCreate(username, body);
      }
    },
    patchCard: async (cardId, patch, opts) => {
      const existing = await resolveCachedCard(username, cardId, opts);
      if (!existing) {
        throw new Error(
          !readBrowserOnline() ? "Contact not found in cache while offline" : "Contact not found",
        );
      }
      if (!readBrowserOnline()) {
        return queueOfflinePatch(username, cardId, patch, existing, opts);
      }
      const token = concurrencyToken(existing, opts);
      try {
        const card = await patchCardWithState(cardId, patch, {
          ...opts,
          ifInState: token,
        });
        await upsertContactCardInCache(username, card, false);
        await runner.flush();
        return card;
      } catch (error) {
        rethrowUnlessOfflineQueue(error, opts);
        return queueOfflinePatch(username, cardId, patch, existing, opts);
      }
    },
    deleteCard: async (cardId, opts) => {
      const cached = await readContactsBootstrapFromCache(username);
      const existing = cached?.data.cards.find((c) => c.id === cardId);
      const token = existing ? concurrencyToken(existing, opts) : opts?.ifInState;
      if (!readBrowserOnline()) {
        await queueOfflineDelete(username, cardId, token);
        return;
      }
      try {
        await deleteCardWithState(cardId, { ...opts, ifInState: token });
        await removeContactCardFromCache(username, cardId);
        await runner.flush();
      } catch (error) {
        rethrowUnlessOfflineQueue(error, opts);
        await queueOfflineDelete(username, cardId, token);
      }
    },
    downloadCardVcf: async (cardId, opts) => {
      const card = await resolveCachedCard(username, cardId, opts);
      if (!card) throw new Error("Contact not found");
      return contactCardToVCard(card);
    },
    importVcards: async (vcardText, opts) => {
      if (!readBrowserOnline()) {
        throw new Error("vCard import requires an internet connection");
      }
      return importVcards(vcardText, opts);
    },
    patchAddressBook: async (addressBookId, patch, opts) => {
      if (!readBrowserOnline()) {
        return queueOfflineBookUpdate(username, addressBookId, patch);
      }
      try {
        const book = await patchAddressBook(addressBookId, patch, opts);
        await upsertAddressBookInCache(username, book);
        await runner.flush();
        return book;
      } catch (error) {
        rethrowUnlessOfflineQueue(error, opts);
        return queueOfflineBookUpdate(username, addressBookId, patch);
      }
    },
  };
}

async function rememberContactsSyncState(
  username: string,
  books: { id?: string }[],
  anchor?: ContactsBootstrapSyncAnchor,
): Promise<void> {
  let bookState = anchor?.addressBookState;
  let cardState = anchor?.contactCardState;
  if (!bookState || !cardState) {
    const { client, accountId } = await connectedContacts();
    if (!bookState) bookState = client.getState(accountId, "AddressBook");
    if (!cardState) cardState = client.getState(accountId, "ContactCard");
  }
  if (bookState) await writeAddressBooksSyncToken(username, bookState);
  if (!cardState) return;
  for (const book of books) {
    if (book.id) await writeSyncToken(username, book.id, cardState);
  }
}

type ContactsBootstrap = Awaited<ReturnType<typeof fetchContactsLiveBootstrap>>;

/**
 * Full download. On a cold device (or after an unfinished first download)
 * each card page is saved as it arrives, behind a "not finished" marker. A
 * refresh over a complete copy still replaces it only at the end, so an
 * interrupted refresh cannot mix old and new rows.
 */
export async function fetchContactsHybridBootstrap(
  onProgress?: (bootstrap: ContactsBootstrap) => void,
): Promise<ContactsBootstrap> {
  // An unfinished first download is never restarted: its saved pages, remaining
  // ids and query-time anchor stay until it completes. Refresh finishes it.
  const unfinishedName = readOfflineContactsUsername();
  if (unfinishedName && readBrowserOnline() && (await readContactsColdDownload(unfinishedName))) {
    const saved = await readContactsBootstrapFromCache(unfinishedName);
    if (saved) return finishContactsDownload(unfinishedName, saved, onProgress);
  }
  let savingFor: string | null = null;
  let owner: string | null = null;
  const bootstrap = await fetchContactsLiveBootstrap({
    onProgress,
    onStart: async ({ session, addressBooks, cardIds, syncAnchor }) => {
      const name = session.user.username;
      if (!name) return;
      if (await readContactsColdDownload(name)) return;
      if (await hasContactsCopy(name)) return;
      await startContactsColdDownload(name, session, addressBooks, {
        ...syncAnchor,
        remainingCardIds: cardIds,
      });
      savingFor = name;
      owner = syncAnchor.contactCardState;
    },
    onCardPage: async ({ cards, remainingCardIds }) => {
      if (savingFor && owner) {
        await saveContactsColdDownloadPage(savingFor, cards, remainingCardIds, owner);
      }
    },
  });
  const username = bootstrap.session.user.username;
  if (!username) {
    throw new Error("Contacts bootstrap missing username");
  }
  if (savingFor) {
    // Every page is stored already: replacing the copy now would only open a
    // window where the cards are gone and the marker says nothing is missing.
    await rememberContactsSyncState(username, bootstrap.data.addressBooks, bootstrap.syncAnchor);
    await finishContactsColdDownload(username, owner ?? undefined);
    if (readBrowserOnline()) await runnerFor(username).flush();
    return bootstrap;
  }
  if (readBrowserOnline()) {
    await runnerFor(username).flush();
  }
  await writeContactsBootstrapToCache(username, bootstrap);
  await rememberContactsSyncState(username, bootstrap.data.addressBooks, bootstrap.syncAnchor);
  return bootstrap;
}

const resumesInFlight = new Map<string, Promise<ContactsAppBootstrap>>();

/**
 * Finishes an interrupted first download: fetches only the missing cards,
 * then stores the original query-time states as sync tokens. The next
 * `/changes` replays everything since that query. Throws on a network error;
 * the saved pages and the marker stay for the next try.
 */
function resumeContactsColdDownload(
  username: string,
  saved: ContactsAppBootstrap,
  progress: ContactsColdDownload,
  reportProgress?: (bootstrap: ContactsAppBootstrap) => void,
): Promise<ContactsAppBootstrap> {
  const inFlight = resumesInFlight.get(username);
  if (inFlight) return inFlight;
  const run = (async () => {
    const cards = new Map(saved.data.cards.map((card) => [card.id, card]));
    const publish = () =>
      reportProgress?.({ ...saved, data: { ...saved.data, cards: [...cards.values()] } });
    publish();
    if (progress.remainingCardIds.length > 0) {
      await fetchContactCardPages(progress.remainingCardIds, async (page) => {
        const kept = await saveContactsColdDownloadPage(
          username,
          page.cards,
          page.remainingCardIds,
          progress.contactCardState,
        );
        for (const card of kept) cards.set(card.id, card);
        publish();
      });
    }
    // A restarted download owns the marker now: it stores its own tokens.
    const stored = await readContactsColdDownload(username);
    if (
      stored?.contactCardState === progress.contactCardState &&
      stored.addressBookState === progress.addressBookState
    ) {
      await rememberContactsSyncState(username, saved.data.addressBooks, progress);
      await finishContactsColdDownload(username, progress.contactCardState);
    }
    // Edits queued offline on the partial copy go out now; the flush's pull
    // starts at the query-time tokens stored above.
    if (readBrowserOnline()) await runnerFor(username).flush();
    return (await readContactsBootstrapFromCache(username)) ?? saved;
  })().finally(() => resumesInFlight.delete(username));
  resumesInFlight.set(username, run);
  return run;
}

/** Resumes the first download when one is unfinished; otherwise returns `saved`. */
async function finishContactsDownload(
  username: string,
  saved: ContactsAppBootstrap,
  reportProgress?: (bootstrap: ContactsAppBootstrap) => void,
): Promise<ContactsAppBootstrap> {
  const progress = await readContactsColdDownload(username);
  if (!progress || !readBrowserOnline()) return saved;
  return resumeContactsColdDownload(username, saved, progress, reportProgress);
}

export async function loadContactsBootstrapHybrid(
  reportProgress?: (bootstrap: ContactsBootstrap) => void,
): Promise<ContactsBootstrap> {
  if (!readBrowserOnline()) {
    const username = readOfflineContactsUsername();
    if (username) {
      const cached = await readContactsBootstrapFromCache(username);
      if (cached) return cached;
    }
    throw new Error("No cached contacts available offline");
  }

  return fetchContactsHybridBootstrap(reportProgress);
}

/**
 * Stored copy for the first paint. Null while online with an unfinished first
 * download, so boot goes through {@link loadContactsBootstrapForBoot} and
 * shows the rest arriving (edits stay locked until it is complete). Offline,
 * the saved part is returned as is.
 */
export async function readContactsCacheForBoot(
  username: string,
): Promise<ContactsAppBootstrap | null> {
  if (readBrowserOnline() && (await readContactsColdDownload(username))) return null;
  return readContactsBootstrapFromCache(username);
}

/**
 * Boot path: a stored address book paints immediately. A cold device still
 * downloads the book, reporting each page through `reportProgress`. A first
 * download that stopped halfway fetches only the missing cards. If that fails
 * (network gone, a 502 from a proxy), the saved part opens and the next boot
 * or refresh tries again.
 * Explicit refresh stays on {@link loadContactsBootstrapHybrid}.
 */
export async function loadContactsBootstrapForBoot(
  reportProgress?: (bootstrap: ContactsBootstrap) => void,
): Promise<ContactsBootstrap> {
  const username = readOfflineContactsUsername();
  if (username) {
    const cached = await readContactsBootstrapFromCache(username);
    if (cached) {
      try {
        return await finishContactsDownload(username, cached, reportProgress);
      } catch {
        return (await readContactsBootstrapFromCache(username)) ?? cached;
      }
    }
  }
  return loadContactsBootstrapHybrid(reportProgress);
}

/**
 * Incremental refresh after a cached list is already on screen. An unfinished
 * first download (opened offline) completes first, so its query-time sync
 * tokens exist before the first `/changes`.
 */
export async function refreshCachedContacts(username: string): Promise<void> {
  const saved = await readContactsBootstrapFromCache(username);
  if (saved) await finishContactsDownload(username, saved);
  await syncContactBooksAfterAddressBookChanges(username);
}

export function getContactsSyncRunner(username: string): ConnectivitySyncRunner<OutboxFlushResult> {
  return runnerFor(username);
}
