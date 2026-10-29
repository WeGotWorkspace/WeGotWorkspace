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
  discardContactsColdDownload,
  enqueueOutboxMutation,
  finishContactsColdDownload,
  hasContactsCopy,
  hasQueuedContactEdits,
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

function bookIdsOf(books: AddressBook[]): string[] {
  return books.map((book) => book.id).filter((id): id is string => Boolean(id));
}

/**
 * After a download finished and its marker is gone: send edits queued on the
 * partial copy. The flush pulls `/changes` from the tokens just stored. With
 * nothing queued it is left to the next refresh, so a download costs no extra
 * pull.
 */
async function sendQueuedEditsAfterDownload(username: string): Promise<void> {
  if (!readBrowserOnline() || !(await hasQueuedContactEdits(username))) return;
  await runnerFor(username).flush();
}

/**
 * Full download. On a device with no copy, each card page is saved as it
 * arrives, behind a marker this download owns; once the last page is in, only
 * the query-time tokens are stored (no rewrite of the saved pages). With a
 * stored copy (complete, or an unfinished one reached outside
 * {@link loadContactsBootstrapHybrid}) nothing changes until the full snapshot
 * is in; then it replaces the copy in one transaction.
 */
export async function fetchContactsHybridBootstrap(
  onProgress?: (bootstrap: ContactsBootstrap) => void,
): Promise<ContactsBootstrap> {
  let saving: { username: string; id: string } | null = null;
  const bootstrap = await fetchContactsLiveBootstrap({
    onProgress,
    onStart: async ({ session, addressBooks, cardIds, syncAnchor }) => {
      const name = session.user.username;
      if (!name || (await hasContactsCopy(name))) return;
      const id = crypto.randomUUID();
      await startContactsColdDownload(name, session, addressBooks, {
        id,
        ...syncAnchor,
        remainingCardIds: cardIds,
      });
      saving = { username: name, id };
    },
    onCardPage: async ({ cards, remainingCardIds }) => {
      if (saving)
        await saveContactsColdDownloadPage(saving.username, saving.id, cards, remainingCardIds);
    },
  });
  const username = bootstrap.session.user.username;
  if (!username) {
    throw new Error("Contacts bootstrap missing username");
  }
  const savedPages = saving as { username: string; id: string } | null;
  if (savedPages) {
    const books = bookIdsOf(bootstrap.data.addressBooks);
    if (await finishContactsColdDownload(username, savedPages.id, books)) {
      await sendQueuedEditsAfterDownload(username);
    }
    return bootstrap;
  }
  if (readBrowserOnline()) {
    await runnerFor(username).flush();
  }
  await writeContactsBootstrapToCache(username, bootstrap);
  await rememberContactsSyncState(username, bootstrap.data.addressBooks, bootstrap.syncAnchor);
  if (await discardContactsColdDownload(username)) {
    await sendQueuedEditsAfterDownload(username);
  }
  return bootstrap;
}

/** Ends a resume early: another download owns the marker now. */
class ColdDownloadTakenOver extends Error {}

const resumesInFlight = new Map<string, Promise<ContactsAppBootstrap>>();

/**
 * Finishes an interrupted first download: fetches only the missing cards,
 * then stores the original query-time states as sync tokens. The next
 * `/changes` replays everything since that query. Page saves and the finish
 * only apply while the marker still names this download. One resume per user
 * at a time: a second caller (a Refresh, a reconnect) joins the running one.
 * Throws on a network or HTTP error; the saved pages and the marker stay.
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
    try {
      if (progress.remainingCardIds.length > 0) {
        await fetchContactCardPages(progress.remainingCardIds, async (page) => {
          const kept = await saveContactsColdDownloadPage(
            username,
            progress.id,
            page.cards,
            page.remainingCardIds,
          );
          if (!kept) throw new ColdDownloadTakenOver();
          for (const card of kept) cards.set(card.id, card);
          publish();
        });
      }
      const books = bookIdsOf(saved.data.addressBooks);
      if (await finishContactsColdDownload(username, progress.id, books)) {
        await sendQueuedEditsAfterDownload(username);
      }
    } catch (error) {
      if (!(error instanceof ColdDownloadTakenOver)) throw error;
    }
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

/**
 * Explicit load (header Refresh, cold boot). With an unfinished first download
 * stored, it joins or starts the resume: a new full download would have to
 * clear the saved cards first.
 */
export async function loadContactsBootstrapHybrid(
  reportProgress?: (bootstrap: ContactsBootstrap) => void,
): Promise<ContactsBootstrap> {
  const username = readOfflineContactsUsername();
  const saved = username ? await readContactsBootstrapFromCache(username) : null;
  if (!readBrowserOnline()) {
    if (saved) return saved;
    throw new Error("No cached contacts available offline");
  }
  if (username && saved && (await readContactsColdDownload(username))) {
    return finishContactsDownload(username, saved, reportProgress);
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
      } catch (error) {
        // Offline or a proxy error is expected here; anything else should leave a trace.
        if (!isFetchNetworkError(error)) {
          console.warn("[contacts] resuming the first download failed", error);
        }
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
