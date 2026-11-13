import type {
  AddressBookMutationPatch,
  ContactCardCreate,
  ContactCardPatch,
} from "@/lib/models/contacts-types";
import { contactCardSet, ContactStateMismatchError } from "@/lib/api/wgw/contacts-set";
import { getCard, patchAddressBook } from "@/lib/api/wgw/contacts";
import { JmapSetItemError } from "@/lib/jmap-client";
import { runOutboxFlush } from "@/lib/offline/core/outbox-flush";
import { pullAddressBookChanges, syncAllContactBooks } from "@/lib/api/wgw/contacts-sync";
import type { ContactsAppBootstrap } from "@/lib/api/mock/contacts-bootstrap";
import { getOutboxMutation, settleSentOutboxMutation } from "@/lib/offline/core/outbox-store";
import type { OfflineOutboxRow } from "@/lib/offline/core/types";
import { CONTACTS_DOMAIN, contactsCardsTable } from "@/lib/offline/contacts/contacts-schema";
import {
  markOutboxError,
  readCachedAddressBooks,
  readContactsBootstrapFromCache,
  readContactsColdDownload,
  removeOutboxMutation,
  removeContactCardFromCache,
  upsertAddressBookInCache,
  upsertContactCardInCache,
  writeContactsBootstrapToCache,
} from "@/lib/offline/contacts-offline-store";

function isNotFoundSetType(type: string | undefined): boolean {
  return type === "notFound";
}

function isNotFoundSetError(error: unknown): boolean {
  return error instanceof JmapSetItemError && error.setError.type === "notFound";
}

export type OutboxFlushResult = {
  stateMismatches: string[];
  bootstrap: ContactsAppBootstrap | null;
};

export async function flushContactsOutbox(username: string): Promise<OutboxFlushResult> {
  const cached = await readContactsBootstrapFromCache(username);
  // An unfinished first download has no sync tokens yet: the pull below would
  // start from "0:" and download every card again. Wait until it is finished.
  if (!cached || (await readContactsColdDownload(username))) {
    return { stateMismatches: [], bootstrap: null };
  }

  const stateMismatches: string[] = [];

  /** The server no longer has the card: drop the row and let the pull settle the cache. */
  async function gone(row: OfflineOutboxRow, cardId: string): Promise<"handled"> {
    if (cardId) stateMismatches.push(cardId);
    await removeOutboxMutation(username, row.id);
    return "handled";
  }

  /** The card changed on the server since the edit was queued: a conflict for the person. */
  async function conflict(row: OfflineOutboxRow, cardId: string): Promise<"handled"> {
    stateMismatches.push(cardId);
    await markOutboxError(username, row.id, "stateMismatch");
    return "handled";
  }

  await runOutboxFlush<Record<string, unknown>>(username, {
    domain: CONTACTS_DOMAIN,
    parse: (row) => JSON.parse(row.payload) as Record<string, unknown>,
    send: async (payload, row, context) => {
      if (row.op === "create") {
        const creationId = String(payload.creationId ?? row.id);
        const body = payload.body as ContactCardCreate;
        const response = await contactCardSet({ create: { [creationId]: body } });
        const notCreated = response.notCreated[creationId];
        if (isNotFoundSetType(notCreated?.type)) {
          return gone(row, String(payload.tempCardId ?? creationId));
        }
        // A refused create (`forbidden`) keeps its 403 in the runner's record.
        if (notCreated) throw new JmapSetItemError("create", creationId, notCreated);
        const serverId = response.created[creationId];
        if (!serverId) throw new Error("Create failed");
        if (!(await getOutboxMutation(username, row.id))) {
          // Undone while it was sent (`dropQueuedContactCreate`): take it back.
          await contactCardSet({ destroy: [serverId] });
          return "handled";
        }
        const tempId = String(payload.tempCardId ?? "");
        if (tempId) await removeContactCardFromCache(username, tempId);
        const card = await getCard(serverId);
        await upsertContactCardInCache(username, card, false);
      } else if (row.op === "update") {
        const cardId = String(payload.cardId ?? "");
        const patch = payload.patch as ContactCardPatch;
        const updateEntry: ContactCardPatch & { ifInState?: string } = { ...patch };
        if (row.ifInState) updateEntry.ifInState = row.ifInState;
        const response = await contactCardSet({ update: { [cardId]: updateEntry } });
        if (isNotFoundSetType(response.notUpdated[cardId]?.type)) return gone(row, cardId);
        if (response.notUpdated[cardId]?.type === "stateMismatch") return conflict(row, cardId);
        // Never settle a refused update with the server copy: that loses the
        // offline edit. `forbidden` becomes a permanent 403 in the runner's record.
        const notUpdated = response.notUpdated[cardId];
        if (notUpdated) throw new JmapSetItemError("update", cardId, notUpdated);
        const card = await getCard(cardId);
        // A patch merged in while this one was sent is owed on the new state.
        const settlement = await settleSentOutboxMutation(username, row, {
          rebase: (current) => ({ ...current, ifInState: response.updated[cardId] }),
          cacheTables: (db) => [contactsCardsTable(db)],
          onRemoved: () => upsertContactCardInCache(username, card, false),
        });
        context.resend(settlement);
        return "handled";
      } else if (row.op === "delete") {
        const cardId = String(payload.cardId ?? "");
        const destroy = row.ifInState ? { [cardId]: { ifInState: row.ifInState } } : [cardId];
        const response = await contactCardSet({ destroy });
        if (isNotFoundSetType(response.notDestroyed[cardId]?.type)) return gone(row, cardId);
        if (response.notDestroyed[cardId]?.type === "stateMismatch") return conflict(row, cardId);
        await removeContactCardFromCache(username, cardId);
      } else if (row.op === "bookUpdate") {
        const addressBookId = String(payload.addressBookId ?? "");
        const patch = payload.patch as AddressBookMutationPatch;
        const book = await patchAddressBook(addressBookId, patch);
        await upsertAddressBookInCache(username, book);
      }
    },
    onFailure: async ({ row, error }) => {
      if (error instanceof ContactStateMismatchError) {
        await conflict(row, error.cardId);
        return true;
      }
      if (isNotFoundSetError(error)) {
        const payload = JSON.parse(row.payload) as Record<string, unknown>;
        await gone(row, String(payload.cardId ?? payload.tempCardId ?? payload.creationId ?? ""));
        return true;
      }
      return false;
    },
  });

  await pullAddressBookChanges(username);

  const books = await readCachedAddressBooks(username);
  const bookIds = books.map((b) => b.id).filter((id): id is string => Boolean(id && id.length > 0));
  if (bookIds.length > 0) {
    await syncAllContactBooks(username, bookIds);
  }

  const nextBootstrap = await readContactsBootstrapFromCache(username);
  if (nextBootstrap) {
    nextBootstrap.session = cached.session;
    nextBootstrap.data.addressBooks = books;
    await writeContactsBootstrapToCache(username, nextBootstrap);
  }

  return { stateMismatches, bootstrap: nextBootstrap };
}
