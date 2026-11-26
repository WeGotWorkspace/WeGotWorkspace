import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressBook, ContactCard } from "@/lib/models/contacts-types";
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
} from "@/lib/offline/contacts/contacts-offline-store";
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
  getCards,
  listAddressBooks,
  addressBookChanges,
  contactCardChanges,
  listCards,
  connectedContacts,
} = vi.hoisted(() => ({
  getAddressBook: vi.fn(),
  getCard: vi.fn(),
  // By default the batch answers each id through `getCard`, like the server would.
  getCards: vi.fn(),
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
    getCards,
    listCards,
    addressBookChanges,
    contactCardChanges,
    connectedContacts,
  };
});

beforeEach(() => {
  getCards.mockImplementation(async (ids: string[]) => {
    const cards = await Promise.all(ids.map((id) => getCard(id).catch(() => null)));
    return cards.filter((card): card is ContactCard => Boolean(card));
  });
});

vi.mock("@/lib/offline/contacts/contacts-sync-conflicts", () => ({
  reportContactsSyncConflicts: vi.fn(),
}));

import {
  pullAddressBookChanges,
  pullContactCardChangesForBook,
  syncAllContactBooks,
} from "@/lib/api/wgw/contacts-sync";
import { reportContactsSyncConflicts } from "@/lib/offline/contacts/contacts-sync-conflicts";

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

  it("syncs the cards of every changed book in one run, fetching a moved card once", async () => {
    await upsertAddressBookInCache(username, extraBook);
    await writeSyncToken(username, "default", "cards-1");
    await writeSyncToken(username, "extra-book", "cards-1");
    addressBookChanges.mockResolvedValueOnce({
      oldState: "books-1",
      newState: "books-2",
      created: [],
      updated: ["default", "extra-book"],
      destroyed: [],
    } satisfies JmapChangesResponse);
    getAddressBook.mockImplementation(async (id: string) =>
      id === "default" ? defaultBook : extraBook,
    );
    getCards.mockResolvedValue([
      { id: "moved", addressBookIds: { "extra-book": true } } as unknown as ContactCard,
    ]);
    contactCardChanges.mockResolvedValue({
      oldState: "cards-1",
      newState: "cards-2",
      created: ["moved"],
      updated: [],
      destroyed: [],
    } satisfies JmapChangesResponse);

    await pullAddressBookChanges(username);

    expect(getCards).toHaveBeenCalledOnce();
    expect(getCards).toHaveBeenCalledWith(["moved"], { signal: undefined, paced: false });
    expect(await readSyncToken(username, "default")).toBe("cards-2");
    expect(await readSyncToken(username, "extra-book")).toBe("cards-2");
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

  it("removes a card that only belonged to the book and unlinks a card shared with another", async () => {
    contactCardChanges.mockRejectedValueOnce(
      new JmapMethodError("ContactCard/changes", "c0", { type: "cannotCalculateChanges" }),
    );
    const onlyHere = {
      id: "only-here",
      "@type": "Card",
      version: "1.0",
      uid: "urn:uuid:only-here",
      addressBookIds: { default: true },
      name: { "@type": "Name", isOrdered: false, full: "Only Here" },
    } as unknown as ContactCard;
    const shared = {
      id: "shared",
      "@type": "Card",
      version: "1.0",
      uid: "urn:uuid:shared",
      addressBookIds: { default: true, extra: true },
      name: { "@type": "Name", isOrdered: false, full: "Shared" },
    } as unknown as ContactCard;
    const elsewhere = {
      id: "elsewhere",
      "@type": "Card",
      version: "1.0",
      uid: "urn:uuid:elsewhere",
      addressBookIds: { extra: true },
      name: { "@type": "Name", isOrdered: false, full: "Elsewhere" },
    } as unknown as ContactCard;
    const kept = {
      id: "kept",
      "@type": "Card",
      version: "1.0",
      uid: "urn:uuid:kept",
      addressBookIds: { default: true },
      name: { "@type": "Name", isOrdered: false, full: "Kept" },
    } as unknown as ContactCard;
    const pendingOnly = {
      id: "pending-only",
      "@type": "Card",
      version: "1.0",
      uid: "urn:uuid:pending-only",
      addressBookIds: { default: true },
      name: { "@type": "Name", isOrdered: false, full: "Pending" },
    } as unknown as ContactCard;
    await writeContactsBootstrapToCache(username, {
      session: { ...mockWorkspaceSession, user: { ...mockWorkspaceSession.user, username } },
      data: {
        addressBooks: [defaultBook, extraBook],
        cards: [onlyHere, shared, elsewhere, kept, pendingOnly],
      },
    });
    await upsertContactCardInCache(username, pendingOnly, true);
    listCards.mockResolvedValueOnce([kept]);

    await pullContactCardChangesForBook(username, "default");

    const cached = await readContactsBootstrapFromCache(username);
    const byId = new Map((cached?.data.cards ?? []).map((card) => [card.id, card]));
    expect(byId.has("only-here")).toBe(false);
    expect(byId.get("shared")?.addressBookIds).toEqual({ extra: true });
    expect(byId.get("elsewhere")?.addressBookIds).toEqual({ extra: true });
    expect(byId.get("kept")?.id).toBe("kept");
    expect(byId.get("pending-only")?.addressBookIds).toEqual({ default: true });
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

describe("syncAllContactBooks", () => {
  const card = (id: string, books: string[]) =>
    ({
      id,
      "@type": "Card",
      version: "1.0",
      uid: `urn:uuid:${id}`,
      addressBookIds: Object.fromEntries(books.map((book) => [book, true])),
      name: { "@type": "Name", isOrdered: false, full: id },
    }) as unknown as ContactCard;

  beforeEach(async () => {
    vi.clearAllMocks();
    connectedContacts.mockResolvedValue({
      client: { getState: () => "card-state-9" },
      accountId: username,
    });
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await contactsBooksTable(db).clear();
    await contactsCardsTable(db).clear();
    await db.meta.clear();
  });

  it("fetches a changed card once for every book and stores each book's state", async () => {
    await writeSyncToken(username, "default", "card-state-1");
    await writeSyncToken(username, "extra-book", "card-state-1");
    // ContactCard/changes is account-wide: both books get the same answer.
    contactCardChanges.mockResolvedValue({
      oldState: "card-state-1",
      newState: "card-state-2",
      created: [],
      updated: ["both"],
      destroyed: [],
    } satisfies JmapChangesResponse);
    getCards.mockResolvedValue([card("both", ["default", "extra-book"])]);

    await syncAllContactBooks(username, ["default", "extra-book"]);

    expect(contactCardChanges).toHaveBeenCalledTimes(2);
    expect(getCards).toHaveBeenCalledOnce();
    expect(getCards).toHaveBeenCalledWith(["both"], { signal: undefined, paced: false });
    expect(getCard).not.toHaveBeenCalled();
    expect(await readSyncToken(username, "default")).toBe("card-state-2");
    expect(await readSyncToken(username, "extra-book")).toBe("card-state-2");
  });

  it("fetches many changed cards a page at a time, pacing every page after the first", async () => {
    await writeContactsBootstrapToCache(username, {
      session: { ...mockWorkspaceSession, user: { ...mockWorkspaceSession.user, username } },
      data: { addressBooks: [defaultBook], cards: [] },
    });
    await writeSyncToken(username, "default", "card-state-1");
    const ids = Array.from({ length: 200 }, (_, index) => `imported-${index}`);
    contactCardChanges.mockResolvedValue({
      oldState: "card-state-1",
      newState: "card-state-2",
      created: ids,
      updated: [],
      destroyed: [],
    } satisfies JmapChangesResponse);
    // The last card was deleted before it was fetched: the server leaves it out.
    getCards.mockImplementation(async (page: string[]) =>
      page.filter((id) => id !== "imported-199").map((id) => card(id, ["default"])),
    );

    await syncAllContactBooks(username, ["default"]);

    expect(getCard).not.toHaveBeenCalled();
    expect(getCards).toHaveBeenCalledTimes(5);
    expect(getCards.mock.calls.map(([page]) => (page as string[]).length)).toEqual([
      40, 40, 40, 40, 40,
    ]);
    expect(getCards.mock.calls.map(([, opts]) => (opts as { paced: boolean }).paced)).toEqual([
      false,
      true,
      true,
      true,
      true,
    ]);
    const cached = await readContactsBootstrapFromCache(username);
    const cachedIds = new Set((cached?.data.cards ?? []).map((row) => row.id));
    expect(cachedIds.size).toBe(199);
    expect(cachedIds.has("imported-199")).toBe(false);
    expect(await readSyncToken(username, "default")).toBe("card-state-2");
  });

  it("keeps a cached card that a page leaves out, and still advances the token", async () => {
    const kept = {
      ...card("kept", ["default"]),
      name: { "@type": "Name", isOrdered: false, full: "Cached copy" },
    } as ContactCard;
    await writeContactsBootstrapToCache(username, {
      session: { ...mockWorkspaceSession, user: { ...mockWorkspaceSession.user, username } },
      data: { addressBooks: [defaultBook], cards: [kept] },
    });
    await writeSyncToken(username, "default", "card-state-1");
    contactCardChanges.mockResolvedValue({
      oldState: "card-state-1",
      newState: "card-state-2",
      created: ["fresh"],
      updated: ["kept"],
      destroyed: [],
    } satisfies JmapChangesResponse);
    // The server still stores "kept" but cannot return it (over the read guard).
    getCards.mockImplementation(async (page: string[]) =>
      page.filter((id) => id !== "kept").map((id) => card(id, ["default"])),
    );

    await syncAllContactBooks(username, ["default"]);

    const cached = await readContactsBootstrapFromCache(username);
    expect(cached?.data.cards.find((row) => row.id === "kept")?.name?.full).toBe("Cached copy");
    expect(cached?.data.cards.some((row) => row.id === "fresh")).toBe(true);
    expect(reportContactsSyncConflicts).not.toHaveBeenCalled();
    expect(await readSyncToken(username, "default")).toBe("card-state-2");
  });

  it("deletes a card that the full lists of both its books lack", async () => {
    await writeContactsBootstrapToCache(username, {
      session: { ...mockWorkspaceSession, user: { ...mockWorkspaceSession.user, username } },
      data: {
        addressBooks: [defaultBook, extraBook],
        cards: [card("in-both", ["default", "extra-book"]), card("kept", ["default"])],
      },
    });
    contactCardChanges.mockRejectedValue(
      new JmapMethodError("ContactCard/changes", "c0", { type: "cannotCalculateChanges" }),
    );
    listCards.mockImplementation(async ({ addressBookId }: { addressBookId: string }) =>
      addressBookId === "default" ? [card("kept", ["default"])] : [],
    );

    await syncAllContactBooks(username, ["default", "extra-book"]);

    const cached = await readContactsBootstrapFromCache(username);
    expect(cached?.data.cards.map((row) => row.id)).toEqual(["kept"]);
    expect(await readSyncToken(username, "default")).toBe("card-state-9");
    expect(await readSyncToken(username, "extra-book")).toBe("card-state-9");
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
