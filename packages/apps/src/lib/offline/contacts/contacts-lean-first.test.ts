import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressBook, ContactCard } from "@/lib/models/contacts-types";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import {
  finishContactsColdDownload,
  listOutboxMutations,
  readContactsBootstrapFromCache,
  readContactsDetailPassRun,
  readContactsPartialCardIds,
  saveContactsColdDownloadPage,
  saveContactsDetailPage,
  startContactsColdDownload,
  upsertContactCardInCache,
} from "@/lib/offline/contacts/contacts-offline-store";
import { offlineAccountKeyFromUsername, offlineDbForAccount } from "@/lib/offline/core/offline-db";
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

/** What a lean page carries: name and email, no phones, no notes. */
function lean(id: string): ContactCard {
  return {
    id,
    "@type": "Card",
    version: "1.0",
    uid: `urn:uuid:${id}`,
    addressBookIds: { default: true },
    name: { "@type": "Name", isOrdered: false, full: `Name ${id}` },
    emails: { e1: { address: `${id}@example.com` } },
    state: `${id}-state`,
  } as unknown as ContactCard;
}

/** The same card with everything the lean page leaves out. */
function whole(id: string): ContactCard {
  return {
    ...lean(id),
    phones: { p1: { number: "+31 6 1234 5678" } },
    notes: { n1: { note: "Met at the fair" } },
  } as unknown as ContactCard;
}

vi.mock("@/lib/api/wgw/contacts-mutations", () => ({
  patchCardWithState: vi.fn(),
  createCardWithState: vi.fn(),
  deleteCardWithState: vi.fn(),
}));

vi.mock("@/lib/offline/core/browser-online", () => ({
  readBrowserOnline: vi.fn(() => true),
  isFetchNetworkError: vi.fn(
    (error: unknown) => error instanceof TypeError && error.message.includes("network"),
  ),
  subscribeBrowserOnline: vi.fn(() => () => undefined),
}));

const { getCard, connectedContacts } = vi.hoisted(() => ({
  getCard: vi.fn(),
  connectedContacts: vi.fn(),
}));

vi.mock("@/lib/api/wgw/contacts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/wgw/contacts")>();
  return { ...actual, getCard, connectedContacts };
});

vi.mock("@/lib/api/wgw/contacts-bootstrap", () => ({
  fetchContactsLiveBootstrap: vi.fn(),
  fetchContactCardPages: vi.fn(),
  fetchContactCardDetails: vi.fn(),
  fetchContactCardPhotos: vi.fn(async () => undefined),
}));

vi.mock("@/lib/api/wgw/contacts-sync", () => ({
  pullAddressBookChanges: vi.fn(),
  syncAllContactBooks: vi.fn(),
  syncContactBooksAfterAddressBookChanges: vi.fn(),
}));

import { patchCardWithState } from "@/lib/api/wgw/contacts-mutations";
import {
  fetchContactCardDetails,
  fetchContactCardPhotos,
  fetchContactsLiveBootstrap,
} from "@/lib/api/wgw/contacts-bootstrap";
import {
  ContactDetailsNotDownloadedError,
  createHybridContactsOperations,
  fetchContactsHybridBootstrap,
} from "@/lib/offline/contacts/contacts-hybrid-operations";
import {
  runContactsBackgroundPasses,
  runContactsDetailPass,
} from "@/lib/offline/contacts/contacts-detail-pass";
import { readBrowserOnline } from "@/lib/offline/core/browser-online";

type LiveOptions = NonNullable<Parameters<typeof fetchContactsLiveBootstrap>[0]>;

async function freshDevice(): Promise<void> {
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
}

/** A finished lean first download of `ids`: every card stored partial. */
async function storeLeanCopy(ids: string[]): Promise<void> {
  await startContactsColdDownload(username, session, [book], {
    id: "download-1",
    ...syncAnchor,
    remainingCardIds: ids,
  });
  await saveContactsColdDownloadPage(username, "download-1", ids.map(lean), []);
  expect(await finishContactsColdDownload(username, "download-1", ["default"])).toBe(true);
}

async function cachedCard(id: string): Promise<ContactCard | undefined> {
  const cached = await readContactsBootstrapFromCache(username);
  return cached?.data.cards.find((row) => row.id === id);
}

describe("partial cards of a lean first download", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(readBrowserOnline).mockReturnValue(true);
    connectedContacts.mockResolvedValue({
      client: { getState: () => "state-now" },
      accountId: username,
    });
    await freshDevice();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("the marker", () => {
    it("lists every saved card as partial when the download finishes", async () => {
      await storeLeanCopy(["a", "b"]);

      expect((await readContactsPartialCardIds(username)).sort()).toEqual(["a", "b"]);
      const cached = await readContactsBootstrapFromCache(username);
      expect(cached?.partialCardIds?.slice().sort()).toEqual(["a", "b"]);
    });

    it("takes a card off the list when a whole card is stored, and keeps it when told to", async () => {
      await storeLeanCopy(["a", "b"]);

      await upsertContactCardInCache(username, whole("a"));
      await upsertContactCardInCache(username, lean("b"), false, { keepPartial: true });

      expect(await readContactsPartialCardIds(username)).toEqual(["b"]);
    });

    it("a detail page completes only partial cards and keeps the stored photo", async () => {
      await storeLeanCopy(["a", "b", "c"]);
      const photo = { m1: { uri: "blob:photo" } } as unknown as ContactCard["media"];
      const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
      const table = contactsCardsTable(db);
      const row = await table.get("a");
      await table.put({ ...row!, data: JSON.stringify({ ...lean("a"), media: photo }) });
      // "c" became whole through another route (an open, a live sync).
      await upsertContactCardInCache(username, whole("c"));
      const newerC = { ...whole("c"), notes: { n1: { note: "kept" } } } as unknown as ContactCard;

      const pass = await readContactsDetailPassRun(username);
      const saved = await saveContactsDetailPage(username, pass!.id, [
        whole("a"),
        whole("b"),
        newerC,
      ]);

      expect(saved).toEqual({ changed: 2, superseded: false });
      expect(await readContactsDetailPassRun(username)).toBeNull();
      expect(await cachedCard("a")).toMatchObject({ phones: whole("a").phones, media: photo });
      expect(await cachedCard("b")).toMatchObject({ notes: whole("b").notes });
      // The card that was whole already is not overwritten by the page.
      expect((await cachedCard("c"))?.notes).toEqual(whole("c").notes);
    });

    it("leaves a card with unsynced local edits alone and listed", async () => {
      await storeLeanCopy(["a"]);
      await upsertContactCardInCache(username, lean("a"), true, { keepPartial: true });

      const pass = await readContactsDetailPassRun(username);
      const saved = await saveContactsDetailPage(username, pass!.id, [whole("a")]);

      expect(saved.changed).toBe(0);
      expect(await readContactsPartialCardIds(username)).toEqual(["a"]);
      expect((await cachedCard("a"))?.phones).toBeUndefined();
    });

    it("drops a card that is gone from the list without storing it", async () => {
      await storeLeanCopy(["a", "gone"]);
      const db = offlineDbForAccount(offlineAccountKeyFromUsername(username));
      await contactsCardsTable(db).delete("gone");

      const pass = await readContactsDetailPassRun(username);
      await saveContactsDetailPage(username, pass!.id, [whole("a"), whole("gone")]);

      expect(await readContactsPartialCardIds(username)).toEqual([]);
      expect(await cachedCard("gone")).toBeUndefined();
    });
  });

  describe("the first download", () => {
    it("asks for lean cards on a device with no copy", async () => {
      vi.mocked(fetchContactsLiveBootstrap).mockImplementation(async (options?: LiveOptions) => {
        await options?.onStart?.({
          session,
          addressBooks: [book],
          cardIds: ["a"],
          groupIds: [],
          syncAnchor,
        });
        await options?.onCardPage?.({ cards: [lean("a")], remainingCardIds: [] });
        return { data: { addressBooks: [book], cards: [lean("a")] }, session, syncAnchor };
      });
      vi.mocked(fetchContactCardDetails).mockImplementation(async (_ids, onPage) => {
        await onPage({ cards: [whole("a")], remainingCardIds: [] });
      });

      await fetchContactsHybridBootstrap();

      expect(fetchContactsLiveBootstrap).toHaveBeenCalledWith(
        expect.objectContaining({ lean: true }),
      );
      await vi.waitFor(async () => expect(await readContactsPartialCardIds(username)).toEqual([]));
      expect(fetchContactCardDetails).toHaveBeenCalledWith(
        ["a"],
        expect.any(Function),
        expect.anything(),
      );
      expect((await cachedCard("a"))?.phones).toEqual(whole("a").phones);
    });

    it("refreshes a device with a copy with whole cards and clears the partial list", async () => {
      await storeLeanCopy(["a"]);
      vi.mocked(fetchContactsLiveBootstrap).mockResolvedValue({
        data: { addressBooks: [book], cards: [whole("a")] },
        session,
        syncAnchor,
      });

      await fetchContactsHybridBootstrap();

      expect(fetchContactsLiveBootstrap).toHaveBeenCalledWith(
        expect.objectContaining({ lean: false }),
      );
      expect(await readContactsPartialCardIds(username)).toEqual([]);
      expect((await cachedCard("a"))?.phones).toEqual(whole("a").phones);
    });
  });

  describe("the hard rule: a partial card is never edited from its partial copy", () => {
    it("online, a patch fetches the whole card first and builds on it", async () => {
      await storeLeanCopy(["a"]);
      getCard.mockResolvedValue(whole("a"));
      vi.mocked(patchCardWithState).mockResolvedValue({
        ...whole("a"),
        name: { "@type": "Name", isOrdered: false, full: "Renamed" },
        state: "a-state-2",
      } as unknown as ContactCard);
      const ops = createHybridContactsOperations(username);

      await ops.patchCard("a", { "name/full": "Renamed" } as never);

      expect(getCard).toHaveBeenCalledWith("a", undefined);
      // The write goes out against the state of the whole card, and the stored copy is whole.
      expect(patchCardWithState).toHaveBeenCalledWith(
        "a",
        { "name/full": "Renamed" },
        expect.objectContaining({ ifInState: "a-state" }),
      );
      expect(await readContactsPartialCardIds(username)).toEqual([]);
      expect((await cachedCard("a"))?.phones).toEqual(whole("a").phones);
    });

    it("offline, a patch fails with a clear error and queues nothing", async () => {
      await storeLeanCopy(["a"]);
      vi.mocked(readBrowserOnline).mockReturnValue(false);
      const ops = createHybridContactsOperations(username);

      await expect(ops.patchCard("a", { "name/full": "Renamed" } as never)).rejects.toBeInstanceOf(
        ContactDetailsNotDownloadedError,
      );

      expect(await listOutboxMutations(username)).toEqual([]);
      expect(getCard).not.toHaveBeenCalled();
      expect((await cachedCard("a"))?.name?.full).toBe("Name a");
      expect(await readContactsPartialCardIds(username)).toEqual(["a"]);
    });

    it("a network failure while fetching the whole card leaves it partial and queues nothing", async () => {
      await storeLeanCopy(["a"]);
      getCard.mockRejectedValue(new TypeError("network error"));
      const ops = createHybridContactsOperations(username);

      await expect(ops.patchCard("a", { "name/full": "Renamed" } as never)).rejects.toBeInstanceOf(
        ContactDetailsNotDownloadedError,
      );

      expect(await listOutboxMutations(username)).toEqual([]);
      expect(patchCardWithState).not.toHaveBeenCalled();
      expect(await readContactsPartialCardIds(username)).toEqual(["a"]);
    });

    it("does not export a vCard from a partial copy offline", async () => {
      await storeLeanCopy(["a"]);
      vi.mocked(readBrowserOnline).mockReturnValue(false);
      const ops = createHybridContactsOperations(username);

      await expect(ops.downloadCardVcf!("a")).rejects.toBeInstanceOf(
        ContactDetailsNotDownloadedError,
      );
    });

    it("opening a partial card online fetches the whole card at once, once", async () => {
      await storeLeanCopy(["a"]);
      getCard.mockResolvedValue(whole("a"));
      const ops = createHybridContactsOperations(username);

      const [first, second] = await Promise.all([ops.getCard("a"), ops.getCard("a")]);

      expect(first.phones).toEqual(whole("a").phones);
      expect(second.phones).toEqual(whole("a").phones);
      expect(getCard).toHaveBeenCalledTimes(1);
      expect(await readContactsPartialCardIds(username)).toEqual([]);
      expect((await cachedCard("a"))?.phones).toEqual(whole("a").phones);
    });

    it("offline, opening a partial card shows the partial copy and stays partial", async () => {
      await storeLeanCopy(["a"]);
      vi.mocked(readBrowserOnline).mockReturnValue(false);
      const ops = createHybridContactsOperations(username);

      const opened = await ops.getCard("a");

      expect(opened.name?.full).toBe("Name a");
      expect(getCard).not.toHaveBeenCalled();
      expect(await readContactsPartialCardIds(username)).toEqual(["a"]);
    });

    it("a card that is not partial is patched as before, without an extra fetch", async () => {
      await storeLeanCopy(["a", "b"]);
      await upsertContactCardInCache(username, whole("b"));
      vi.mocked(patchCardWithState).mockResolvedValue(whole("b"));
      const ops = createHybridContactsOperations(username);

      await ops.patchCard("b", { "name/full": "Renamed" } as never);

      expect(getCard).not.toHaveBeenCalled();
      expect(await readContactsPartialCardIds(username)).toEqual(["a"]);
    });
  });

  describe("the detail pass", () => {
    it("fetches the partial cards paced as bulk work, saves page by page, then the photos follow", async () => {
      await storeLeanCopy(["a", "b", "c"]);
      const order: string[] = [];
      vi.mocked(fetchContactCardDetails).mockImplementation(async (ids, onPage) => {
        order.push(`details:${ids.join(",")}`);
        await onPage({ cards: [whole("a"), whole("b")], remainingCardIds: ["c"] });
        order.push("page1");
        await onPage({ cards: [whole("c")], remainingCardIds: [] });
      });
      vi.mocked(fetchContactCardPhotos).mockImplementation(async () => {
        order.push("photos");
      });

      await runContactsBackgroundPasses(username);

      expect(order[0]).toBe("details:a,b,c");
      expect(order.at(-1)).toBe("photos");
      expect(await readContactsPartialCardIds(username)).toEqual([]);
      expect((await cachedCard("c"))?.notes).toEqual(whole("c").notes);
    });

    it("resumes from the stored list after it was stopped", async () => {
      await storeLeanCopy(["a", "b", "c"]);
      vi.mocked(fetchContactCardDetails).mockImplementationOnce(async (_ids, onPage) => {
        await onPage({ cards: [whole("a")], remainingCardIds: ["b", "c"] });
        throw new TypeError("network error");
      });
      await runContactsDetailPass(username);
      expect((await readContactsPartialCardIds(username)).sort()).toEqual(["b", "c"]);

      vi.mocked(fetchContactCardDetails).mockImplementationOnce(async (ids, onPage) => {
        expect(ids.sort()).toEqual(["b", "c"]);
        await onPage({ cards: [whole("b"), whole("c")], remainingCardIds: [] });
      });
      await runContactsDetailPass(username);

      expect(await readContactsPartialCardIds(username)).toEqual([]);
    });

    it("does not fetch offline or with nothing partial", async () => {
      await storeLeanCopy(["a"]);
      vi.mocked(readBrowserOnline).mockReturnValue(false);
      await runContactsDetailPass(username);
      expect(fetchContactCardDetails).not.toHaveBeenCalled();

      vi.mocked(readBrowserOnline).mockReturnValue(true);
      await upsertContactCardInCache(username, whole("a"));
      await runContactsDetailPass(username);
      expect(fetchContactCardDetails).not.toHaveBeenCalled();
    });

    it("stops when what is left cannot be saved, instead of asking again", async () => {
      await storeLeanCopy(["a"]);
      await upsertContactCardInCache(username, lean("a"), true, { keepPartial: true });
      vi.mocked(fetchContactCardDetails).mockImplementation(async (_ids, onPage) => {
        await onPage({ cards: [whole("a")], remainingCardIds: [] });
      });

      await runContactsDetailPass(username);

      expect(fetchContactCardDetails).toHaveBeenCalledTimes(1);
    });
  });
});
