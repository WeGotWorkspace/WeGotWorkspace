import type { ContactsAppBootstrap } from "@/lib/api/mock/contacts-bootstrap";
import type { ContactCard, ContactsAPIOperations } from "@/lib/models/contacts-types";
import { createHybridContactsOperations } from "@/lib/offline/contacts/contacts-hybrid-operations";
import {
  readContactsBootstrapFromCache,
  readSyncToken,
  removeContactCardFromCache,
  upsertContactCardInCache,
  writeContactsBootstrapToCache,
  writeSyncToken,
} from "@/lib/offline/contacts/contacts-offline-store";
import type { OfflineDomainOperations, OfflineDomainStore } from "@/lib/offline/core/types";

/**
 * Contacts persistence wired to {@link OfflineDomainStore}. Domain-specific helpers
 * (outbox coalescing, address-book tokens, etc.) stay on `contacts-offline-store.ts`.
 */
export const contactsOfflineDomainStore = {
  readBootstrap: readContactsBootstrapFromCache,
  writeBootstrap: writeContactsBootstrapToCache,
  upsertEntity: upsertContactCardInCache,
  removeEntity: removeContactCardFromCache,
  readSyncToken,
  writeSyncToken,
} satisfies OfflineDomainStore<ContactsAppBootstrap, ContactCard>;

/** Contacts hybrid API factory wired to {@link OfflineDomainOperations}. */
export const contactsHybridDomainOperations: OfflineDomainOperations<ContactsAPIOperations> =
  createHybridContactsOperations;
