import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressBook, ContactCard } from "@/contacts-core/src/contacts-types";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import { JmapMethodError } from "@/lib/jmap-client";
import {
  readAddressBooksSyncToken,
  readCachedAddressBooks,
  readContactsBootstrapFromCache,
  readSyncToken,
  upsertAddressBookInCache,
  upsertContactCardInCache,
  writeAddressBooksSyncToken,
  writeContactsBootstrapToCache,
  writeSyncToken,
} from "@/lib/offline/contacts-offline-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { contactsBooksTable, contactsCardsTable } from "@/lib/offline/contacts/contacts-schema";

const username = "alice";

const defaultBook: AddressBook = {
  id: "default",
  name: "Default",
  sortOrder: 0,
  isDefault: true,
  isSubscribed: true,
  isSharee: false,
  myRights: { mayRead: true, mayWrite: true, mayShare: false, mayDelete: true },
};

const extraBook: AddressBook = {
  ...defaultBook,
  id: "extra-book",
  name: "Extra",
  isDefault: false,
};

const newBook: AddressBook = {
  ...defaultBook,
  id: "new-book",
  name: "New book",
  isDefault: false,
};

const {
  getAddressBook,
  getCard,
  listAddressBooks,
  addressBookChanges,
  contactCardChanges,
  listCards,
  connectedContacts,
} = vi.hoisted(() => ({
  getAddressBook: vi.fn(),
  getCard: vi.fn(),
  listAddressBooks: vi.fn(),
  addressBookChanges: vi.fn(),
  contactCardChanges: vi.fn(),
  listCards: vi.fn(),
  connectedContacts: vi.fn(),
}));

vi.mock("@/lib/api/wgw/contacts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/wgw/contacts")>();
  return {
    ...actual,
    getAddressBook,
    listAddressBooks,
    getCard,
    listCards,
    addressBookChanges,
    contactCardChanges,
    connectedContacts,
  };
});

vi.mock("@/lib/offline/contacts-sync-conflicts", () => ({
  reportContactsSyncConflicts: vi.fn(),
}));

import { pullAddressBookChanges, pullContactCardChangesForBook } from "@/lib/api/wgw/contacts-sync";
import { reportContactsSyncConflicts } from "@/lib/offline/contacts-sync-conflicts";

type JmapChangesResponse = {
  oldState: string;
  newState: string;
  created: string[];
  updated: string[];
  destroyed: string[];
};

describe("pullAddressBookChanges", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    connectedContacts.mockResolvedValue({
      client: { getState: () => "1:default:3" },
      accountId: username,
    });
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await contactsBooksTable(db).clear();
    await contactsCardsTable(db).clear();
    await db.meta.clear();
    await writeContactsBootstrapToCache(username, {
      session: { ...mockWorkspaceSession, user: { ...mockWorkspaceSession.user, username } },
      data: { addressBooks: [defaultBook], cards: [] },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("advances the address books sync token after a successful changes response", async () => {
    addressBookChanges.mockResolvedValueOnce({
      oldState: "0:",
      newState: "1:default:3",
      created: [],
      updated: [],
      destroyed: [],
    } satisfies JmapChangesResponse);

    await pullAddressBookChanges(username);

    expect(await readAddressBooksSyncToken(username)).toBe("1:default:3");
    expect(addressBookChanges).toHaveBeenCalledWith("0:", undefined);
  });

  it("persists the token on empty changes without mutating cached books", async () => {
    await writeAddressBooksSyncToken(username, "1:default:2");
    addressBookChanges.mockResolvedValueOnce({
      oldState: "1:default:2",
      newState: "1:default:3",
      created: [],
      updated: [],
      destroyed: [],
    } satisfies JmapChangesResponse);

    await pullAddressBookChanges(username);

    expect(await readAddressBooksSyncToken(username)).toBe("1:default:3");
    const books = await readCachedAddressBooks(username);
    expect(books).toHaveLength(1);
    expect(books[0]?.id).toBe("default");
  });

  it("upserts created books and removes destroyed books from cache", async () => {
    await upsertAddressBookInCache(username, extraBook);
    await writeSyncToken(username, "extra-book", "5");
    await writeAddressBooksSyncToken(username, "2:default:1,extra-book:1");

    addressBookChanges.mockResolvedValueOnce({
      oldState: "2:default:1,extra-book:1",
      newState: "3:default:1,new-book:1",
      created: ["new-book"],
      updated: [],
      destroyed: ["extra-book"],
    } satisfies JmapChangesResponse);

    getAddressBook.mockResolvedValueOnce(newBook);
    contactCardChanges.mockResolvedValueOnce({
      oldState: "0:",
      newState: "1",
      created: [],
      updated: [],
      destroyed: [],
    } satisfies JmapChangesResponse);

    await pullAddressBookChanges(username);

    const books = await readCachedAddressBooks(username);
    expect(books.map((book) => book.id).sort()).toEqual(["default", "new-book"]);
    expect(getAddressBook).toHaveBeenCalledWith("new-book", undefined);
    expect(await readSyncToken(username, "extra-book")).toBeNull();
    expect(await readAddressBooksSyncToken(username)).toBe("3:default:1,new-book:1");
  });

  it("full-resyncs address books when changes cannot be calculated", async () => {
    addressBookChanges.mockRejectedValueOnce(
      new JmapMethodError("AddressBook/changes", "c0", { type: "cannotCalculateChanges" }),
    );
    listAddressBooks.mockResolvedValueOnce([defaultBook]);

    await pullAddressBookChanges(username);

    expect(listAddressBooks).toHaveBeenCalledOnce();
    expect(await readAddressBooksSyncToken(username)).toBe("1:default:3");
  });
});

describe("pullContactCardChangesForBook", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    connectedContacts.mockResolvedValue({
      client: { getState: () => "card-state-1" },
      accountId: username,
    });
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await contactsBooksTable(db).clear();
    await contactsCardsTable(db).clear();
    await db.meta.clear();
  });

  it("full-resyncs a book when ContactCard/changes cannot be calculated", async () => {
    contactCardChanges.mockRejectedValueOnce(
      new JmapMethodError("ContactCard/changes", "c0", { type: "cannotCalculateChanges" }),
    );
    listCards.mockResolvedValueOnce([]);

    await pullContactCardChangesForBook(username, "default");

    expect(listCards).toHaveBeenCalledWith({ addressBookId: "default", signal: undefined });
    expect(await readSyncToken(username, "default")).toBe("card-state-1");
  });

  it("skips pending cards and reports the conflict channel", async () => {
    const card = {
      id: "jane-doe",
      "@type": "Card",
      version: "1.0",
      uid: "urn:uuid:jane",
      addressBookIds: { default: true },
      name: { "@type": "Name", isOrdered: false, full: "Jane" },
    } as unknown as ContactCard;
    await writeContactsBootstrapToCache(username, {
      session: { ...mockWorkspaceSession, user: { ...mockWorkspaceSession.user, username } },
      data: { addressBooks: [defaultBook], cards: [card] },
    });
    await upsertContactCardInCache(username, card, true);
    contactCardChanges.mockResolvedValueOnce({
      oldState: "0:",
      newState: "2",
      created: [],
      updated: ["jane-doe"],
      destroyed: [],
    } satisfies JmapChangesResponse);

    await pullContactCardChangesForBook(username, "default");

    expect(getCard).not.toHaveBeenCalled();
    expect(reportContactsSyncConflicts).toHaveBeenCalledWith(["jane-doe"]);
  });
});

describe("destroyed book + pending outbox", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    connectedContacts.mockResolvedValue({
      client: { getState: () => "1:default:3" },
      accountId: username,
    });
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await contactsBooksTable(db).clear();
    await contactsCardsTable(db).clear();
    await db.meta.clear();
  });

  it("keeps pending cards, drops synced cards, and reports conflicts", async () => {
    const groupBook: AddressBook = {
      ...defaultBook,
      id: "group-eng",
      name: "Engineering",
      isDefault: false,
    };
    const pendingCard = {
      id: "pending-1",
      "@type": "Card",
      version: "1.0",
      uid: "urn:uuid:pending",
      addressBookIds: { "group-eng": true },
      name: { "@type": "Name", isOrdered: false, full: "Pending" },
    } as unknown as ContactCard;
    const syncedCard = {
      id: "synced-1",
      "@type": "Card",
      version: "1.0",
      uid: "urn:uuid:synced",
      addressBookIds: { "group-eng": true },
      name: { "@type": "Name", isOrdered: false, full: "Synced" },
    } as unknown as ContactCard;
    await writeContactsBootstrapToCache(username, {
      session: { ...mockWorkspaceSession, user: { ...mockWorkspaceSession.user, username } },
      data: { addressBooks: [defaultBook, groupBook], cards: [pendingCard, syncedCard] },
    });
    await upsertContactCardInCache(username, pendingCard, true);

    addressBookChanges.mockResolvedValueOnce({
      oldState: "0:",
      newState: "2:default:1",
      created: [],
      updated: [],
      destroyed: ["group-eng"],
    } satisfies JmapChangesResponse);

    await pullAddressBookChanges(username);

    const books = await readCachedAddressBooks(username);
    expect(books.map((book) => book.id)).toEqual(["default"]);
    const cached = await readContactsBootstrapFromCache(username);
    expect(cached?.data.cards.map((card) => card.id)).toEqual(["pending-1"]);
    expect(reportContactsSyncConflicts).toHaveBeenCalledWith(["pending-1"]);
  });
});
