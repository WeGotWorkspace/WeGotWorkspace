import "fake-indexeddb/auto";
import { describe, expect, it, beforeEach } from "vitest";
import type { ContactsAppBootstrap } from "@/lib/api/mock/contacts-bootstrap";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import type { ContactCard, ContactsAPIOperations } from "@/contacts-core/src/contacts-types";
import type { OfflineDomainOperations, OfflineDomainStore } from "@/lib/offline/core/types";
import {
  contactsHybridDomainOperations,
  contactsOfflineDomainStore,
} from "@/lib/offline/contacts/contacts-domain-contract";

const username = "bob";

const bootstrap = {
  session: mockWorkspaceSession,
  data: {
    addressBooks: [
      {
        id: "default",
        name: "Default",
        sortOrder: 0,
        isDefault: true,
        isSubscribed: true,
        isSharee: false,
        myRights: { mayRead: true, mayWrite: true, mayShare: false, mayDelete: true },
      },
    ],
    cards: [
      {
        id: "jane-doe",
        "@type": "Card",
        version: "1.0",
        uid: "urn:uuid:jane",
        addressBookIds: { default: true },
        name: { "@type": "Name", isOrdered: false, full: "Jane Doe" },
        state: "state-1",
      } as unknown as ContactCard,
    ],
  },
} satisfies ContactsAppBootstrap;

/** Compile-time contract checks — referenced so the assignment is not elided. */
const storeContractCheck: OfflineDomainStore<ContactsAppBootstrap, ContactCard> =
  contactsOfflineDomainStore;
const operationsContractCheck: OfflineDomainOperations<ContactsAPIOperations> =
  contactsHybridDomainOperations;

void storeContractCheck;
void operationsContractCheck;

describe("contacts domain contract", () => {
  beforeEach(async () => {
    await contactsOfflineDomainStore.writeBootstrap(username, bootstrap);
  });

  it("store contract reads and writes bootstrap", async () => {
    const cached = await contactsOfflineDomainStore.readBootstrap(username);
    expect(cached?.data.cards[0]?.name?.full).toBe("Jane Doe");
  });

  it("store contract upserts and removes entities", async () => {
    const updated = {
      ...bootstrap.data.cards[0],
      name: { "@type": "Name", isOrdered: false, full: "Jane Updated" },
    } as ContactCard;
    await contactsOfflineDomainStore.upsertEntity(username, updated, true);
    const cached = await contactsOfflineDomainStore.readBootstrap(username);
    expect(cached?.data.cards[0]?.name?.full).toBe("Jane Updated");

    await contactsOfflineDomainStore.removeEntity(username, updated.id);
    const afterRemove = await contactsOfflineDomainStore.readBootstrap(username);
    expect(afterRemove?.data.cards).toHaveLength(0);
  });

  it("store contract reads and writes sync tokens", async () => {
    await contactsOfflineDomainStore.writeSyncToken(username, "default", "token-1");
    await expect(contactsOfflineDomainStore.readSyncToken(username, "default")).resolves.toBe(
      "token-1",
    );
  });

  it("operations factory exposes hybrid API methods", () => {
    const operations = contactsHybridDomainOperations(username);
    expect(typeof operations.listCards).toBe("function");
    expect(typeof operations.createCard).toBe("function");
    expect(typeof operations.patchCard).toBe("function");
    expect(typeof operations.deleteCard).toBe("function");
  });
});
