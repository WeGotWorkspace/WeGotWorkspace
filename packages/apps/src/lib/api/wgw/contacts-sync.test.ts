import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressBook } from "@/contacts-core/src/contacts-types";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import { JmapMethodError } from "@/lib/jmap-client";
import {
  readAddressBooksSyncToken,
  readCachedAddressBooks,
  readSyncToken,
  upsertAddressBookInCache,
  writeAddressBooksSyncToken,
  writeContactsBootstrapToCache,
  writeSyncToken,
} from "@/lib/offline/contacts-offline-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
import { contactsBooksTable } from "@/lib/offline/contacts/contacts-schema";

const username = "alice";

const defaultBook: AddressBook = {
  id: "default",
  name: "Default",
  sortOrder: 0,
  isDefault: true,
  isSubscribed: true,
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
  listAddressBooks,
  addressBookChanges,
  contactCardChanges,
  listCards,
  connectedContacts,
} = vi.hoisted(() => ({
  getAddressBook: vi.fn(),
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
    getCard: vi.fn(),
    listCards,
    addressBookChanges,
    contactCardChanges,
    connectedContacts,
  };
});

import { pullAddressBookChanges, pullContactCardChangesForBook } from "@/lib/api/wgw/contacts-sync";

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
});
