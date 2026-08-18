import type {
  ContactCard,
  ContactCardCreate,
  ContactCardPatch,
  ContactsAPIOperations,
  ContactsMutationOpts,
} from "@/contacts-core/src/contacts-types";
import { fetchContactsLiveBootstrap } from "@/lib/api/wgw/contacts-bootstrap";
import {
  createCardWithState,
  deleteCardWithState,
  patchCardWithState,
} from "@/lib/api/wgw/contacts-mutations";
import { contactCardToVCard } from "@/contacts-core/src/contacts-vcard-export";
import { getCard, importVcards, listAddressBooks, listCards } from "@/lib/api/wgw/contacts";
import { pullAddressBookChanges, syncAllContactBooks } from "@/lib/api/wgw/contacts-sync";
import { isFetchNetworkError, readBrowserOnline } from "@/lib/offline/browser-online";
import { applyContactPatch } from "@/lib/offline/contacts/contacts-patch-merge";
import {
  createTempContactId,
  enqueueCoalescedContactUpdate,
  enqueueOutboxMutation,
  listCachedAddressBookIds,
  readContactsBootstrapFromCache,
  removeContactCardFromCache,
  upsertContactCardInCache,
  writeContactsBootstrapToCache,
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

const syncRunnerRegistry = new ConnectivitySyncRunnerRegistry<OutboxFlushResult>();

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

export function createHybridContactsOperations(username: string): ContactsAPIOperations {
  const runner = runnerFor(username);

  return {
    listAddressBooks: (opts) => listAddressBooks(opts),
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
  };
}

export async function fetchContactsHybridBootstrap(): Promise<
  Awaited<ReturnType<typeof fetchContactsLiveBootstrap>>
> {
  const bootstrap = await fetchContactsLiveBootstrap();
  const username = bootstrap.session.user.username;
  if (!username) {
    throw new Error("Contacts bootstrap missing username");
  }
  if (readBrowserOnline()) {
    await flushContactsOutboxAndReport(username);
  }
  await writeContactsBootstrapToCache(username, bootstrap);
  if (readBrowserOnline()) {
    await pullAddressBookChanges(username);
    const bookIds = await listCachedAddressBookIds(username);
    if (bookIds.length > 0) {
      await syncAllContactBooks(username, bookIds);
      const cached = await readContactsBootstrapFromCache(username);
      if (cached) {
        cached.session = bootstrap.session;
        await writeContactsBootstrapToCache(username, cached);
        return cached;
      }
    }
  }
  return bootstrap;
}

export async function loadContactsBootstrapHybrid(): Promise<
  Awaited<ReturnType<typeof fetchContactsLiveBootstrap>>
> {
  if (!readBrowserOnline()) {
    const username = readOfflineContactsUsername();
    if (username) {
      const cached = await readContactsBootstrapFromCache(username);
      if (cached) return cached;
    }
    throw new Error("No cached contacts available offline");
  }

  return fetchContactsHybridBootstrap();
}

export function getContactsSyncRunner(username: string): ConnectivitySyncRunner<OutboxFlushResult> {
  return runnerFor(username);
}
