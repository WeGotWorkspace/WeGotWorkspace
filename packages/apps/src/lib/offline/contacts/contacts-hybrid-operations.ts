import type {
  AddressBook,
  AddressBookMutationPatch,
  ContactCard,
  ContactCardCreate,
  ContactCardPatch,
  ContactsAPIOperations,
  ContactsMutationOpts,
} from "@/lib/models/contacts-types";
import {
  fetchContactCardPages,
  fetchContactsLiveBootstrap,
} from "@/lib/api/wgw/contacts-bootstrap";
import {
  createCardWithState,
  deleteCardWithState,
  patchCardWithState,
} from "@/lib/api/wgw/contacts-mutations";
import { contactCardToVCard } from "@/lib/models/contacts-vcard-export";
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
import { countPendingContacts } from "@/lib/jmap-client";
import { isFetchNetworkError, readBrowserOnline } from "@/lib/offline/core/browser-online";
import { applyContactPatch } from "@/lib/offline/contacts/contacts-patch-merge";
import type { ContactsAppBootstrap } from "@/lib/api/mock/contacts-bootstrap";
import {
  createTempContactId,
  dropQueuedContactCreate,
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
  startContactsPhotoPass,
  type ContactsColdDownload,
  upsertAddressBookInCache,
  upsertContactCardInCache,
  writeAddressBooksSyncToken,
  writeContactsBootstrapToCache,
  withStoredPhotos,
  writeSyncToken,
} from "@/lib/offline/contacts/contacts-offline-store";
import { runContactsPhotoPass } from "@/lib/offline/contacts/contacts-photo-pass";
import { notifyContactsCacheChanged } from "@/lib/offline/contacts/contacts-cache-changed";
import { CONTACTS_DOMAIN } from "@/lib/offline/contacts/contacts-schema";
import {
  flushContactsOutbox,
  type OutboxFlushResult,
} from "@/lib/offline/contacts/contacts-outbox-flush";
import { reportContactsSyncConflicts } from "@/lib/offline/contacts/contacts-sync-conflicts";
import { readOfflineContactsUsername } from "@/lib/offline/core/offline-session";
import {
  ConnectivitySyncRunner,
  ConnectivitySyncRunnerRegistry,
} from "@/lib/offline/core/connectivity-sync-runner";
import { OfflineNotCachedError } from "@/lib/offline/core/offline-not-cached-error";

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
      if (await dropQueuedContactCreate(username, cardId)) return;
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

const FIRST_DOWNLOAD_LOCK = "wgw.contacts.firstDownload";

/**
 * Runs a first download (or its resume) in one tab of this browser at a time,
 * so Contacts and Calendar tabs never fetch the same address book twice. A tab
 * that waited here finds the other tab's copy afterwards. Without Web Locks
 * every tab downloads for itself.
 */
function oneDownloadPerBrowser<T>(work: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks) return work();
  return locks.request(FIRST_DOWNLOAD_LOCK, work) as Promise<T>;
}

/**
 * Full download. On a device with no copy, each card page is saved as it
 * arrives, behind a marker this download owns; once the last page is in, only
 * the query-time tokens are stored (no rewrite of the saved pages). That first
 * download runs in one tab per browser: a tab that waited for another tab's
 * download returns (or resumes) that copy instead. An unfinished copy (its
 * marker still set) is resumed the same way, never replaced. With a complete
 * copy nothing changes until the full snapshot is in; then it replaces the
 * copy in one transaction.
 */
export async function fetchContactsHybridBootstrap(
  onProgress?: (bootstrap: ContactsBootstrap) => void,
): Promise<ContactsBootstrap> {
  const known = readOfflineContactsUsername();
  // A marker means another tab's first download may still be saving into this
  // copy; refreshing it here would replace the book and discard that marker.
  if (known && (await hasContactsCopy(known)) && !(await readContactsColdDownload(known))) {
    return downloadAllContacts(onProgress);
  }
  return oneDownloadPerBrowser(async () => {
    const name = readOfflineContactsUsername();
    const saved = name ? await readContactsBootstrapFromCache(name) : null;
    if (!name || !saved) return downloadAllContacts(onProgress);
    // Another tab ran the first download while this one waited.
    const progress = await readContactsColdDownload(name);
    if (!progress) return saved;
    return resumeContactsColdDownload(name, saved, progress, onProgress, true);
  });
}

async function downloadAllContacts(
  onProgress?: (bootstrap: ContactsBootstrap) => void,
): Promise<ContactsBootstrap> {
  let saving: { username: string; id: string } | null = null;
  const bootstrap = await fetchContactsLiveBootstrap({
    onProgress,
    onStart: async ({ session, addressBooks, cardIds, groupIds, syncAnchor }) => {
      const name = session.user.username;
      if (!name || (await hasContactsCopy(name))) return;
      const id = crypto.randomUUID();
      await startContactsColdDownload(name, session, addressBooks, {
        id,
        ...syncAnchor,
        remainingCardIds: cardIds,
        groupIds,
      });
      saving = { username: name, id };
    },
    onCardPage: async ({ cards, remainingCardIds }) => {
      if (!saving) return;
      await saveContactsColdDownloadPage(saving.username, saving.id, cards, remainingCardIds);
      notifyContactsCacheChanged(saving.username);
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
      void runContactsPhotoPass(username);
    }
    return bootstrap;
  }
  if (readBrowserOnline()) {
    await runnerFor(username).flush();
  }
  // The pages were photo-less: keep the stored photos until the photo pass is through.
  const cards = await withStoredPhotos(username, bootstrap.data.cards);
  const withPhotos = { ...bootstrap, data: { ...bootstrap.data, cards } };
  await writeContactsBootstrapToCache(username, withPhotos);
  await rememberContactsSyncState(username, bootstrap.data.addressBooks, bootstrap.syncAnchor);
  // Only cards without a photo now: those kept from the stored copy need none.
  await startContactsPhotoPass(
    username,
    cards.filter((card) => !card.media).map((card) => card.id),
  );
  if (await discardContactsColdDownload(username)) {
    await sendQueuedEditsAfterDownload(username);
  }
  void runContactsPhotoPass(username);
  return withPhotos;
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
 * A caller that holds the first-download lock never joins: the running resume
 * may itself be waiting for that lock. It runs its own; the other one finds
 * the download finished once it gets the lock.
 * Throws on a network or HTTP error; the saved pages and the marker stay.
 */
function resumeContactsColdDownload(
  username: string,
  saved: ContactsAppBootstrap,
  progress: ContactsColdDownload,
  reportProgress?: (bootstrap: ContactsAppBootstrap) => void,
  /** The caller holds the one-download-per-browser lock already. */
  locked = false,
): Promise<ContactsAppBootstrap> {
  const inFlight = locked ? undefined : resumesInFlight.get(username);
  if (inFlight) return inFlight;
  const run = (async () => {
    const cards = new Map(saved.data.cards.map((card) => [card.id, card]));
    const groupIds = progress.groupIds ?? null;
    // The count goes with the cards, so All Contacts shows its total from the start.
    const publish = (remainingCardIds: string[]) =>
      reportProgress?.({
        ...saved,
        data: { ...saved.data, cards: [...cards.values()] },
        pendingContactCount: countPendingContacts(remainingCardIds, groupIds),
      });
    publish(progress.remainingCardIds);
    const fetchRest = async () => {
      // Another tab may have fetched some or all of the rest while this one waited.
      const current = await readContactsColdDownload(username);
      if (!current || current.id !== progress.id) return;
      if (current.remainingCardIds.length > 0) {
        await fetchContactCardPages(current.remainingCardIds, async (page) => {
          const kept = await saveContactsColdDownloadPage(
            username,
            progress.id,
            page.cards,
            page.remainingCardIds,
          );
          if (!kept) throw new ColdDownloadTakenOver();
          for (const card of kept) cards.set(card.id, card);
          publish(page.remainingCardIds);
          notifyContactsCacheChanged(username);
        });
      }
      const books = bookIdsOf(saved.data.addressBooks);
      if (await finishContactsColdDownload(username, progress.id, books)) {
        await sendQueuedEditsAfterDownload(username);
        void runContactsPhotoPass(username);
      }
    };
    try {
      await (locked ? fetchRest() : oneDownloadPerBrowser(fetchRest));
    } catch (error) {
      if (!(error instanceof ColdDownloadTakenOver)) throw error;
    }
    return (await readContactsBootstrapFromCache(username)) ?? saved;
  })();
  if (locked) return run;
  const registered = run.finally(() => {
    if (resumesInFlight.get(username) === registered) resumesInFlight.delete(username);
  });
  resumesInFlight.set(username, registered);
  return registered;
}

/** Resumes the first download when one is unfinished; otherwise returns `saved`. */
async function finishContactsDownload(
  username: string,
  saved: ContactsAppBootstrap,
  reportProgress?: (bootstrap: ContactsAppBootstrap) => void,
): Promise<ContactsAppBootstrap> {
  if (!readBrowserOnline()) return saved;
  const progress = await readContactsColdDownload(username);
  if (!progress) {
    // A photo pass that a reload or a lost connection stopped goes on.
    void runContactsPhotoPass(username);
    return saved;
  }
  return resumeContactsColdDownload(username, saved, progress, reportProgress);
}

let ensuring: Promise<void> | null = null;

/**
 * For apps that read the Contacts cache (Calendar invitee search): fills it
 * once for every app by starting, resuming or joining the Contacts first
 * download — paced, in large photo-less pages, one tab per browser. Never
 * downloads a complete copy again, and does nothing offline. Pages land in
 * the cache as they arrive and every tab hears of them.
 */
export function ensureContactsDownloaded(): Promise<void> {
  ensuring ??= (async () => {
    if (!readBrowserOnline()) return;
    const username = readOfflineContactsUsername();
    const saved = username ? await readContactsBootstrapFromCache(username) : null;
    if (username && saved && !(await readContactsColdDownload(username))) return;
    await loadContactsBootstrapHybrid();
  })().finally(() => {
    ensuring = null;
  });
  return ensuring;
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
    throw new OfflineNotCachedError("contacts");
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
