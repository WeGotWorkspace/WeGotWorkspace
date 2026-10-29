import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressBook, ContactCard } from "@/contacts-core/src/contacts-types";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import {
  readAddressBooksSyncToken,
  readContactsBootstrapFromCache,
  readContactsColdDownload,
  readSyncToken,
  upsertContactCardInCache,
  writeContactsBootstrapToCache,
} from "@/lib/offline/contacts-offline-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/offline-db";
import { contactsBooksTable, contactsCardsTable } from "@/lib/offline/contacts/contacts-schema";

const username = "alice";
const session = { ...mockWorkspaceSession, user: { ...mockWorkspaceSession.user, username } };
const book = {
  id: "default",
  name: "Default",
  sortOrder: 0,
  isDefault: true,
  isSubscribed: true,
  isSharee: false,
  myRights: { mayRead: true, mayWrite: true, mayShare: false, mayDelete: true },
} as AddressBook;
const syncAnchor = { addressBookState: "books-at-query", contactCardState: "cards-at-query" };

function card(id: string, full = id): ContactCard {
  return {
    id,
    "@type": "Card",
    version: "1.0",
    uid: `urn:uuid:${id}`,
    addressBookIds: { default: true },
    name: { "@type": "Name", isOrdered: false, full },
    state: `${id}-state`,
  } as unknown as ContactCard;
}

vi.mock("@/lib/offline/browser-online", () => ({
  readBrowserOnline: vi.fn(() => true),
  isFetchNetworkError: vi.fn(
    (error: unknown) => error instanceof TypeError && error.message.includes("network"),
  ),
  subscribeBrowserOnline: vi.fn(() => () => undefined),
}));

const {
  connectedContacts,
  pullAddressBookChanges,
  syncAllContactBooks,
  syncContactBooksAfterAddressBookChanges,
} = vi.hoisted(() => ({
  connectedContacts: vi.fn(),
  pullAddressBookChanges: vi.fn(),
  syncAllContactBooks: vi.fn(),
  syncContactBooksAfterAddressBookChanges: vi.fn(),
}));

vi.mock("@/lib/api/wgw/contacts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/wgw/contacts")>();
  return { ...actual, connectedContacts };
});

vi.mock("@/lib/api/wgw/contacts-bootstrap", () => ({
  fetchContactsLiveBootstrap: vi.fn(),
  fetchContactCardPages: vi.fn(),
}));

vi.mock("@/lib/api/wgw/contacts-sync", () => ({
  pullAddressBookChanges,
  syncAllContactBooks,
  syncContactBooksAfterAddressBookChanges,
}));

import {
  fetchContactCardPages,
  fetchContactsLiveBootstrap,
} from "@/lib/api/wgw/contacts-bootstrap";
import { readBrowserOnline } from "@/lib/offline/browser-online";
import {
  fetchContactsHybridBootstrap,
  getContactsSyncRunner,
  loadContactsBootstrapForBoot,
  readContactsCacheForBoot,
  refreshCachedContacts,
} from "@/lib/offline/contacts-hybrid-operations";

type LiveOptions = NonNullable<Parameters<typeof fetchContactsLiveBootstrap>[0]>;

/** First download that gets the query and page 1, then loses the connection. */
function stopAfterFirstPage(cardIds: string[]) {
  vi.mocked(fetchContactsLiveBootstrap).mockImplementation(async (options?: LiveOptions) => {
    await options?.onStart?.({ session, addressBooks: [book], cardIds, syncAnchor });
    await options?.onCardPage?.({ cards: [card(cardIds[0]!)], remainingCardIds: cardIds.slice(1) });
    throw new TypeError("network error");
  });
}

async function cachedIds(): Promise<string[]> {
  const cached = await readContactsBootstrapFromCache(username);
  return (cached?.data.cards ?? []).map((row) => row.id).sort();
}

describe("contacts first download, saved page by page", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(readBrowserOnline).mockReturnValue(true);
    connectedContacts.mockResolvedValue({
      client: { getState: () => "state-now" },
      accountId: username,
    });
    syncContactBooksAfterAddressBookChanges.mockResolvedValue(undefined);
    pullAddressBookChanges.mockResolvedValue(undefined);
    syncAllContactBooks.mockResolvedValue(undefined);
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => void memory.set(key, value),
      removeItem: (key: string) => void memory.delete(key),
      clear: () => memory.clear(),
    };
    vi.stubGlobal("window", { localStorage: storage });
    vi.stubGlobal("localStorage", storage);
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    await db.outbox.clear();
    await contactsCardsTable(db).clear();
    await contactsBooksTable(db).clear();
    await db.meta.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the pages that arrived when the first download stops halfway", async () => {
    stopAfterFirstPage(["a", "b", "c"]);

    await expect(fetchContactsHybridBootstrap()).rejects.toThrow("network error");

    expect(await cachedIds()).toEqual(["a"]);
    expect(await readContactsColdDownload(username)).toEqual({
      ...syncAnchor,
      remainingCardIds: ["b", "c"],
    });
    // The anchor becomes a sync token only once every card is in.
    expect(await readSyncToken(username, "default")).toBeNull();
    expect(await readAddressBooksSyncToken(username)).toBeNull();
  });

  it("next online boot fetches only the missing cards and stores the query-time anchor", async () => {
    stopAfterFirstPage(["a", "b", "c"]);
    await fetchContactsHybridBootstrap().catch(() => undefined);
    vi.mocked(fetchContactCardPages).mockImplementation(async (_ids, onCardPage) => {
      await onCardPage({ cards: [card("b")], remainingCardIds: ["c"] });
      await onCardPage({ cards: [card("c")], remainingCardIds: [] });
    });

    expect(await readContactsCacheForBoot(username)).toBeNull();
    const painted: number[] = [];
    const loaded = await loadContactsBootstrapForBoot((partial) => {
      painted.push(partial.data.cards.length);
    });

    expect(fetchContactCardPages).toHaveBeenCalledWith(["b", "c"], expect.any(Function));
    expect(fetchContactsLiveBootstrap).toHaveBeenCalledTimes(1);
    expect(painted).toEqual([1, 2, 3]);
    expect(loaded.data.cards.map((row) => row.id).sort()).toEqual(["a", "b", "c"]);
    expect(await cachedIds()).toEqual(["a", "b", "c"]);
    expect(await readContactsColdDownload(username)).toBeNull();
    // Not "state-now": changes between the first attempt and the resume stay visible to /changes.
    expect(await readSyncToken(username, "default")).toBe("cards-at-query");
    expect(await readAddressBooksSyncToken(username)).toBe("books-at-query");
  });

  it("offline boot shows the cards that were kept", async () => {
    stopAfterFirstPage(["a", "b"]);
    await fetchContactsHybridBootstrap().catch(() => undefined);
    vi.mocked(readBrowserOnline).mockReturnValue(false);

    const loaded = await loadContactsBootstrapForBoot();

    expect(loaded.data.cards.map((row) => row.id)).toEqual(["a"]);
    expect((await readContactsCacheForBoot(username))?.data.cards).toHaveLength(1);
    expect(fetchContactCardPages).not.toHaveBeenCalled();
  });

  it.each([
    ["the connection drops", new TypeError("network error")],
    ["the server answers 502", new Error("Bad Gateway")],
  ])("a resume where %s keeps what it has and shows it", async (_label, failure) => {
    stopAfterFirstPage(["a", "b", "c"]);
    await fetchContactsHybridBootstrap().catch(() => undefined);
    vi.mocked(fetchContactCardPages).mockImplementation(async (_ids, onCardPage) => {
      await onCardPage({ cards: [card("b")], remainingCardIds: ["c"] });
      throw failure;
    });

    const loaded = await loadContactsBootstrapForBoot();

    expect(loaded.data.cards.map((row) => row.id).sort()).toEqual(["a", "b"]);
    expect((await readContactsColdDownload(username))?.remainingCardIds).toEqual(["c"]);
    expect(await readSyncToken(username, "default")).toBeNull();
  });

  it("a page does not overwrite a card with unsynced local edits", async () => {
    stopAfterFirstPage(["a", "b"]);
    await fetchContactsHybridBootstrap().catch(() => undefined);
    await upsertContactCardInCache(username, card("b", "Edited offline"), true);
    vi.mocked(fetchContactCardPages).mockImplementation(async (_ids, onCardPage) => {
      await onCardPage({ cards: [card("b", "Server copy")], remainingCardIds: [] });
    });

    const loaded = await loadContactsBootstrapForBoot();

    const b = loaded.data.cards.find((row) => row.id === "b");
    expect(b?.name?.full).toBe("Edited offline");
  });

  it("finishes the download before the first /changes after an offline open", async () => {
    stopAfterFirstPage(["a", "b"]);
    await fetchContactsHybridBootstrap().catch(() => undefined);
    const order: string[] = [];
    vi.mocked(fetchContactCardPages).mockImplementation(async (_ids, onCardPage) => {
      order.push("resume");
      await onCardPage({ cards: [card("b")], remainingCardIds: [] });
    });
    syncContactBooksAfterAddressBookChanges.mockImplementation(async () => {
      order.push(`changes since ${await readSyncToken(username, "default")}`);
    });

    await refreshCachedContacts(username);

    expect(order).toEqual(["resume", "changes since cards-at-query"]);
  });

  it("a refresh over a finished copy replaces it only at the end", async () => {
    await writeContactsBootstrapToCache(username, {
      session,
      data: { addressBooks: [book], cards: [card("old")] },
    });
    stopAfterFirstPage(["a", "b"]);

    await expect(fetchContactsHybridBootstrap()).rejects.toThrow("network error");

    expect(await cachedIds()).toEqual(["old"]);
    expect(await readContactsColdDownload(username)).toBeNull();
  });

  it("an outbox flush waits while the first download is unfinished", async () => {
    stopAfterFirstPage(["a", "b"]);
    await fetchContactsHybridBootstrap().catch(() => undefined);

    await getContactsSyncRunner(username).flush();

    // No sync token yet: a pull now would start at "0:" and download every card again.
    expect(pullAddressBookChanges).not.toHaveBeenCalled();
    expect(syncAllContactBooks).not.toHaveBeenCalled();

    vi.mocked(fetchContactCardPages).mockImplementation(async (_ids, onCardPage) => {
      await onCardPage({ cards: [card("b")], remainingCardIds: [] });
    });
    pullAddressBookChanges.mockImplementation(async () => {
      expect(await readAddressBooksSyncToken(username)).toBe("books-at-query");
    });
    await loadContactsBootstrapForBoot();

    expect(pullAddressBookChanges).toHaveBeenCalledTimes(1);
  });

  it("a refresh during an unfinished first download keeps its pages and anchor", async () => {
    stopAfterFirstPage(["a", "b", "c"]);
    await fetchContactsHybridBootstrap().catch(() => undefined);
    vi.mocked(fetchContactsLiveBootstrap).mockClear();
    vi.mocked(fetchContactCardPages).mockImplementation(async (_ids, onCardPage) => {
      await onCardPage({ cards: [card("b")], remainingCardIds: ["c"] });
      throw new TypeError("network error");
    });

    await expect(fetchContactsHybridBootstrap()).rejects.toThrow("network error");

    expect(fetchContactsLiveBootstrap).not.toHaveBeenCalled();
    expect(fetchContactCardPages).toHaveBeenCalledWith(["b", "c"], expect.any(Function));
    expect(await cachedIds()).toEqual(["a", "b"]);
    expect(await readContactsColdDownload(username)).toEqual({
      ...syncAnchor,
      remainingCardIds: ["c"],
    });
  });

  it("a finished cold download keeps the pages it saved and flushes after the marker is gone", async () => {
    vi.mocked(fetchContactsLiveBootstrap).mockImplementation(async (options?: LiveOptions) => {
      await options?.onStart?.({ session, addressBooks: [book], cardIds: ["a", "b"], syncAnchor });
      await options?.onCardPage?.({ cards: [card("a")], remainingCardIds: ["b"] });
      await options?.onCardPage?.({ cards: [card("b")], remainingCardIds: [] });
      expect(await cachedIds()).toEqual(["a", "b"]);
      return { session, data: { addressBooks: [book], cards: [card("a"), card("b")] }, syncAnchor };
    });
    pullAddressBookChanges.mockImplementation(async () => {
      expect(await readContactsColdDownload(username)).toBeNull();
    });

    await fetchContactsHybridBootstrap();

    expect(await cachedIds()).toEqual(["a", "b"]);
    expect(await readContactsColdDownload(username)).toBeNull();
    expect(await readSyncToken(username, "default")).toBe("cards-at-query");
  });

  it("a resume that lost the marker to a restarted download leaves it alone", async () => {
    stopAfterFirstPage(["a", "b", "c"]);
    await fetchContactsHybridBootstrap().catch(() => undefined);
    const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
    vi.mocked(fetchContactCardPages).mockImplementation(async (_ids, onCardPage) => {
      // Another download restarts the marker with a newer anchor.
      await db.meta.put({
        key: "contacts:coldDownload",
        value: JSON.stringify({
          addressBookState: "books-2",
          contactCardState: "cards-2",
          remainingCardIds: ["x", "y"],
        }),
      });
      await onCardPage({ cards: [card("b")], remainingCardIds: [] });
    });

    await loadContactsBootstrapForBoot();

    expect(await cachedIds()).toEqual(["a"]);
    expect(await readContactsColdDownload(username)).toEqual({
      addressBookState: "books-2",
      contactCardState: "cards-2",
      remainingCardIds: ["x", "y"],
    });
    expect(await readSyncToken(username, "default")).toBeNull();
  });
});
