import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContactCard } from "@/contacts-core/src/contacts-types";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import {
  listOutboxMutations,
  readContactsBootstrapFromCache,
  writeContactsBootstrapToCache,
} from "@/lib/offline/contacts-offline-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/offline-db";
import { contactsBooksTable, contactsCardsTable } from "@/lib/offline/contacts/contacts-schema";

const username = "alice";

const card = {
  id: "jane-doe",
  "@type": "Card",
  version: "1.0",
  uid: "urn:uuid:jane",
  addressBookIds: { default: true },
  name: { "@type": "Name", isOrdered: false, full: "Jane Doe" },
  state: "state-1",
} as unknown as ContactCard;

const bootstrap = {
  session: { ...mockWorkspaceSession, user: { ...mockWorkspaceSession.user, username } },
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
    cards: [card],
  },
};

vi.mock("@/lib/api/wgw/contacts-mutations", () => ({
  patchCardWithState: vi.fn(),
  createCardWithState: vi.fn(),
  deleteCardWithState: vi.fn(),
}));

vi.mock("@/lib/offline/browser-online", () => ({
  readBrowserOnline: vi.fn(() => true),
  isFetchNetworkError: vi.fn((error: unknown) => {
    if (error instanceof TypeError) {
      return error.message.toLowerCase().includes("network");
    }
    return false;
  }),
  subscribeBrowserOnline: vi.fn(() => () => undefined),
}));

const { listAddressBooks, patchAddressBook, pullAddressBookChanges, syncAllContactBooks } =
  vi.hoisted(() => ({
    listAddressBooks: vi.fn(),
    patchAddressBook: vi.fn(),
    pullAddressBookChanges: vi.fn(),
    syncAllContactBooks: vi.fn(),
  }));

vi.mock("@/lib/api/wgw/contacts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/wgw/contacts")>();
  return {
    ...actual,
    getCard: vi.fn(),
    listAddressBooks,
    listCards: vi.fn(),
    patchAddressBook,
  };
});

vi.mock("@/lib/api/wgw/contacts-bootstrap", () => ({
  fetchContactsLiveBootstrap: vi.fn(),
}));

vi.mock("@/lib/api/wgw/contacts-sync", () => ({
  pullAddressBookChanges,
  syncAllContactBooks,
}));

import { patchCardWithState } from "@/lib/api/wgw/contacts-mutations";
import { fetchContactsLiveBootstrap } from "@/lib/api/wgw/contacts-bootstrap";
import { readBrowserOnline } from "@/lib/offline/browser-online";
import {
  createHybridContactsOperations,
  fetchContactsHybridBootstrap,
} from "@/lib/offline/contacts-hybrid-operations";

describe("createHybridContactsOperations", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(readBrowserOnline).mockReturnValue(true);
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await db.outbox.clear();
    await contactsCardsTable(db).clear();
    await contactsBooksTable(db).clear();
    await db.meta.clear();
    await writeContactsBootstrapToCache(username, bootstrap);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("queues patch offline and updates IndexedDB when navigator.onLine is false", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(false);

    const operations = createHybridContactsOperations(username);
    const saved = await operations.patchCard("jane-doe", {
      name: { "@type": "Name", isOrdered: false, full: "Jane Updated" },
    });

    expect(saved.name?.full).toBe("Jane Updated");
    expect(patchCardWithState).not.toHaveBeenCalled();

    const cached = await readContactsBootstrapFromCache(username);
    expect(cached?.data.cards[0]?.name?.full).toBe("Jane Updated");

    const outbox = await listOutboxMutations(username);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.op).toBe("update");
    expect(outbox[0]?.ifInState).toBe("state-1");
  });

  it("queues patch when live API fails with a network error", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(true);
    vi.mocked(patchCardWithState).mockRejectedValue(new TypeError("network request failed"));

    const operations = createHybridContactsOperations(username);
    const saved = await operations.patchCard("jane-doe", {
      name: { "@type": "Name", isOrdered: false, full: "Jane Queued" },
    });

    expect(saved.name?.full).toBe("Jane Queued");
    expect(patchCardWithState).toHaveBeenCalledOnce();

    const outbox = await listOutboxMutations(username);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.op).toBe("update");
  });

  it("sets pendingSync on contacts_cards row after offline patch", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(false);

    const operations = createHybridContactsOperations(username);
    await operations.patchCard("jane-doe", {
      name: { "@type": "Name", isOrdered: false, full: "Jane Pending" },
    });

    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    const row = await contactsCardsTable(db).get("jane-doe");
    expect(row?.pendingSync).toBe(true);
    expect(JSON.parse(row?.data ?? "{}").name?.full).toBe("Jane Pending");
  });

  it("retains addresses and members when an offline edit touches another field (#210)", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(false);

    const richCard = {
      ...card,
      addresses: {
        a1: { "@type": "Address", components: [{ kind: "locality", value: "Paris" }] },
      },
      members: { "urn:uuid:m1": true },
    } as unknown as ContactCard;
    await writeContactsBootstrapToCache(username, {
      ...bootstrap,
      data: { ...bootstrap.data, cards: [richCard] },
    });

    const operations = createHybridContactsOperations(username);
    const saved = await operations.patchCard("jane-doe", {
      name: { "@type": "Name", isOrdered: false, full: "Jane Renamed" },
      members: { "urn:uuid:m2": true },
    } as never);

    expect(saved.name?.full).toBe("Jane Renamed");
    expect((saved as unknown as { addresses?: Record<string, unknown> }).addresses?.a1).toEqual({
      "@type": "Address",
      components: [{ kind: "locality", value: "Paris" }],
    });
    expect((saved as unknown as { members?: Record<string, boolean> }).members).toEqual({
      "urn:uuid:m1": true,
      "urn:uuid:m2": true,
    });

    const cached = await readContactsBootstrapFromCache(username);
    const cachedCard = cached?.data.cards[0] as unknown as {
      addresses?: Record<string, unknown>;
      members?: Record<string, boolean>;
    };
    expect(cachedCard?.addresses?.a1).toBeDefined();
    expect(cachedCard?.members).toEqual({ "urn:uuid:m1": true, "urn:uuid:m2": true });
  });

  it("preserves pendingSync cards when bootstrap cache is rewritten", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(false);

    const operations = createHybridContactsOperations(username);
    await operations.patchCard("jane-doe", {
      name: { "@type": "Name", isOrdered: false, full: "Jane Local" },
    });

    await writeContactsBootstrapToCache(username, {
      ...bootstrap,
      data: {
        ...bootstrap.data,
        cards: [
          {
            ...card,
            name: { "@type": "Name", isOrdered: false, full: "Jane Server" },
          },
        ],
      },
    });

    const cached = await readContactsBootstrapFromCache(username);
    expect(cached?.data.cards[0]?.name?.full).toBe("Jane Local");

    const outbox = await listOutboxMutations(username);
    expect(outbox).toHaveLength(1);
  });

  it("serves cached address books when offline", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(false);
    const operations = createHybridContactsOperations(username);
    const books = await operations.listAddressBooks();
    expect(books.map((book) => book.id)).toEqual(["default"]);
    expect(listAddressBooks).not.toHaveBeenCalled();
  });

  it("queues bookUpdate offline for shareWith", async () => {
    vi.mocked(readBrowserOnline).mockReturnValue(false);
    const operations = createHybridContactsOperations(username);
    const shareWith = {
      bob: { mayRead: true, mayWrite: false, mayShare: false, mayDelete: false },
    };
    const updated = await operations.patchAddressBook!("default", { shareWith });
    expect(updated.shareWith).toEqual(shareWith);
    expect(patchAddressBook).not.toHaveBeenCalled();

    const cached = await readContactsBootstrapFromCache(username);
    expect(cached?.data.addressBooks[0]?.shareWith).toEqual(shareWith);

    const outbox = await listOutboxMutations(username);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.op).toBe("bookUpdate");
    expect(JSON.parse(outbox[0]?.payload ?? "{}")).toEqual({
      addressBookId: "default",
      patch: { shareWith },
    });
  });

  it("does not pull AddressBook/ContactCard changes again after bootstrap", async () => {
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await contactsBooksTable(db).clear();
    await contactsCardsTable(db).clear();
    await db.meta.clear();
    vi.mocked(readBrowserOnline).mockReturnValue(true);
    vi.mocked(fetchContactsLiveBootstrap).mockResolvedValue(bootstrap);
    pullAddressBookChanges.mockResolvedValue(undefined);
    syncAllContactBooks.mockResolvedValue(undefined);

    await fetchContactsHybridBootstrap();

    expect(pullAddressBookChanges).not.toHaveBeenCalled();
    expect(syncAllContactBooks).not.toHaveBeenCalled();
  });
});
