import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContactsAppBootstrap } from "@/lib/api/mock/contacts-bootstrap";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import type { ContactCard } from "@/contacts-core/src/contacts-types";
import {
  enqueueCoalescedContactUpdate,
  listOutboxMutations,
  readContactsBootstrapFromCache,
  writeContactsBootstrapToCache,
} from "@/lib/offline/contacts-offline-store";
import {
  resolveConflictFieldMerge,
  resolveConflictKeepLocal,
  resolveConflictUseServer,
} from "@/lib/offline/contacts-conflict-resolution";

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

const { contactCardSet, getCard, pullAddressBookChanges, syncAllContactBooks } = vi.hoisted(() => ({
  contactCardSet: vi.fn(),
  getCard: vi.fn(),
  pullAddressBookChanges: vi.fn(),
  syncAllContactBooks: vi.fn(),
}));

vi.mock("@/lib/api/wgw/contacts-set", () => ({
  contactCardSet,
  ContactStateMismatchError: class ContactStateMismatchError extends Error {
    cardId: string;
    constructor(cardId: string) {
      super("state mismatch");
      this.cardId = cardId;
    }
  },
}));

vi.mock("@/lib/api/wgw/contacts", () => ({
  getCard,
  listAddressBooks: vi.fn().mockResolvedValue([
    {
      id: "default",
      name: "Default",
      sortOrder: 0,
      isDefault: true,
      isSubscribed: true,
      myRights: { mayRead: true, mayWrite: true, mayShare: false, mayDelete: true },
    },
  ]),
}));

vi.mock("@/lib/api/wgw/contacts-sync", () => ({
  pullAddressBookChanges,
  syncAllContactBooks,
}));

describe("contacts conflict resolution", () => {
  beforeEach(async () => {
    contactCardSet.mockReset();
    getCard.mockReset();
    pullAddressBookChanges.mockReset();
    pullAddressBookChanges.mockResolvedValue(undefined);
    syncAllContactBooks.mockReset();
    syncAllContactBooks.mockResolvedValue(undefined);
    await writeContactsBootstrapToCache(username, bootstrap);
  });

  it("keep mine: re-pushes the queued patch with the fresh server ifInState", async () => {
    await enqueueCoalescedContactUpdate(
      username,
      "jane-doe",
      { name: { "@type": "Name", isOrdered: false, full: "Jane Local" } },
      "state-1",
    );

    // Fresh server card advanced to state-2 (the source of the conflict).
    getCard.mockResolvedValue({
      ...bootstrap.data.cards[0],
      name: { "@type": "Name", isOrdered: false, full: "Jane Local" },
      state: "state-2",
    });
    contactCardSet.mockResolvedValue({
      created: {},
      updated: { "jane-doe": null },
      destroyed: {},
      notCreated: {},
      notUpdated: {},
      notDestroyed: {},
    });

    const result = await resolveConflictKeepLocal(username, "jane-doe");

    expect(result.stateMismatches).toEqual([]);
    expect(contactCardSet).toHaveBeenCalledTimes(1);
    expect(contactCardSet.mock.calls[0]?.[0]).toEqual({
      update: {
        "jane-doe": {
          name: { "@type": "Name", isOrdered: false, full: "Jane Local" },
          ifInState: "state-2",
        },
      },
    });
    expect(await listOutboxMutations(username)).toHaveLength(0);
  });

  it("use server: drops the outbox row and refreshes the card from the server", async () => {
    await enqueueCoalescedContactUpdate(
      username,
      "jane-doe",
      { name: { "@type": "Name", isOrdered: false, full: "Jane Local" } },
      "state-1",
    );

    getCard.mockResolvedValue({
      ...bootstrap.data.cards[0],
      name: { "@type": "Name", isOrdered: false, full: "Jane Server" },
      state: "state-2",
    });

    await resolveConflictUseServer(username, "jane-doe");

    expect(contactCardSet).not.toHaveBeenCalled();
    expect(await listOutboxMutations(username)).toHaveLength(0);

    const cached = await readContactsBootstrapFromCache(username);
    expect(cached?.data.cards.find((c) => c.id === "jane-doe")?.name?.full).toBe("Jane Server");
  });

  it("field merge: re-pushes a merged patch with the fresh server ifInState", async () => {
    await enqueueCoalescedContactUpdate(
      username,
      "jane-doe",
      {
        name: { "@type": "Name", isOrdered: false, full: "Jane Local" },
        emails: { e1: { "@type": "EmailAddress", address: "jane@local.example" } },
      },
      "state-1",
    );

    const localCard = {
      ...bootstrap.data.cards[0],
      name: { "@type": "Name", isOrdered: false, full: "Jane Local" },
      emails: { e1: { address: "jane@local.example" } },
    } as unknown as ContactCard;

    getCard.mockResolvedValue({
      ...bootstrap.data.cards[0],
      name: { "@type": "Name", isOrdered: false, full: "Jane Server" },
      emails: { e1: { address: "jane@server.example" } },
      state: "state-2",
    });
    contactCardSet.mockResolvedValue({
      created: {},
      updated: { "jane-doe": null },
      destroyed: {},
      notCreated: {},
      notUpdated: {},
      notDestroyed: {},
    });

    const result = await resolveConflictFieldMerge(username, "jane-doe", localCard, {
      name: "server",
      emails: "local",
      phones: "server",
      addresses: "server",
      urls: "server",
      organization: "server",
      notes: "server",
      title: "server",
      kind: "server",
    });

    expect(result.stateMismatches).toEqual([]);
    expect(contactCardSet).toHaveBeenCalledTimes(1);
    expect(contactCardSet.mock.calls[0]?.[0]).toEqual({
      update: {
        "jane-doe": {
          emails: { e1: { address: "jane@local.example" } },
          ifInState: "state-2",
        },
      },
    });
    expect(await listOutboxMutations(username)).toHaveLength(0);
  });
});
