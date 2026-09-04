import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressBook, ContactCard } from "@/contacts-core/src/contacts-types";
import {
  ingestRemoteAddressBook,
  ingestRemoteAddressBookDestroyed,
  ingestRemoteContactCard,
  ingestRemoteContactCardDestroyed,
  reconcileContactsSnapshot,
} from "@/lib/offline/contacts-jmap-inbound";

const listPending = vi.fn<() => Promise<string[]>>();
const upsert = vi.fn();
const remove = vi.fn();
const upsertBook = vi.fn();
const removeBook = vi.fn();
const listCardsForBook = vi.fn<() => Promise<Array<{ id: string }>>>();
const readCache = vi.fn<
  () => Promise<{
    data: { cards: ContactCard[]; addressBooks: AddressBook[] };
  } | null>
>();
const reportConflicts = vi.fn();

vi.mock("@/lib/offline/contacts-offline-store", () => ({
  listPendingContactCardIds: () => listPending(),
  upsertContactCardInCache: (...args: unknown[]) => upsert(...args),
  removeContactCardFromCache: (...args: unknown[]) => remove(...args),
  upsertAddressBookInCache: (...args: unknown[]) => upsertBook(...args),
  removeAddressBookFromCache: (...args: unknown[]) => removeBook(...args),
  listCachedCardsForAddressBook: () => listCardsForBook(),
  readContactsBootstrapFromCache: () => readCache(),
}));

vi.mock("@/lib/offline/contacts-sync-conflicts", () => ({
  reportContactsSyncConflicts: (...args: unknown[]) => reportConflicts(...args),
}));

const remote = {
  id: "card-1",
  "@type": "Card",
  version: "1.0",
  uid: "urn:uuid:card-1",
  addressBookIds: { default: true },
  name: { "@type": "Name", isOrdered: false, full: "Remote" },
} as unknown as ContactCard;

const defaultBook: AddressBook = {
  id: "default",
  name: "Ada",
  sortOrder: 0,
  isDefault: true,
  isSubscribed: true,
  isSharee: false,
  myRights: { mayRead: true, mayWrite: true, mayShare: true, mayDelete: false },
};

describe("contacts-jmap-inbound", () => {
  beforeEach(() => {
    listPending.mockReset();
    upsert.mockReset();
    remove.mockReset();
    upsertBook.mockReset();
    removeBook.mockReset();
    listCardsForBook.mockReset();
    readCache.mockReset();
    reportConflicts.mockReset();
    listPending.mockResolvedValue([]);
    listCardsForBook.mockResolvedValue([]);
    readCache.mockResolvedValue({ data: { cards: [], addressBooks: [] } });
  });

  it("upserts a remote card into Dexie when the id is not pending", async () => {
    await expect(ingestRemoteContactCard("ada", remote)).resolves.toBe("upserted");
    expect(upsert).toHaveBeenCalledWith("ada", remote, false);
    expect(reportConflicts).not.toHaveBeenCalled();
  });

  it("skips a pending local row and reports the conflict channel", async () => {
    listPending.mockResolvedValue(["card-1"]);
    await expect(ingestRemoteContactCard("ada", remote)).resolves.toBe("skipped-pending");
    expect(upsert).not.toHaveBeenCalled();
    expect(reportConflicts).toHaveBeenCalledWith(["card-1"]);
  });

  it("removes a remotely destroyed card that is not pending", async () => {
    await expect(ingestRemoteContactCardDestroyed("ada", "card-1")).resolves.toBe("removed");
    expect(remove).toHaveBeenCalledWith("ada", "card-1");
  });

  it("does not remove a pending local row on remote destroy", async () => {
    listPending.mockResolvedValue(["card-1"]);
    await expect(ingestRemoteContactCardDestroyed("ada", "card-1")).resolves.toBe(
      "skipped-pending",
    );
    expect(remove).not.toHaveBeenCalled();
    expect(reportConflicts).toHaveBeenCalledWith(["card-1"]);
  });

  it("upserts a remote address book into Dexie", async () => {
    await expect(ingestRemoteAddressBook("ada", defaultBook)).resolves.toBe("upserted");
    expect(upsertBook).toHaveBeenCalledWith("ada", defaultBook);
  });

  it("keeps sharee book and card ids as shared-N", async () => {
    const sharedBook: AddressBook = {
      ...defaultBook,
      id: "shared-42",
      name: "Alice",
      isDefault: false,
      isSharee: true,
      shareWith: null,
      myRights: { mayRead: true, mayWrite: false, mayShare: false, mayDelete: true },
    };
    const sharedCard = {
      ...remote,
      id: "card-shared",
      addressBookIds: { "shared-42": true },
    } as ContactCard;
    await expect(ingestRemoteAddressBook("ada", sharedBook)).resolves.toBe("upserted");
    await expect(ingestRemoteContactCard("ada", sharedCard)).resolves.toBe("upserted");
    expect(upsertBook).toHaveBeenCalledWith("ada", sharedBook);
    expect(upsert).toHaveBeenCalledWith("ada", sharedCard, false);
  });

  it("drops a destroyed book and its cached cards except pending ids", async () => {
    listPending.mockResolvedValue(["card-pending"]);
    listCardsForBook.mockResolvedValue([{ id: "card-gone" }, { id: "card-pending" }]);
    await expect(ingestRemoteAddressBookDestroyed("ada", "group-eng")).resolves.toBe("removed");
    expect(remove).toHaveBeenCalledWith("ada", "card-gone");
    expect(remove).not.toHaveBeenCalledWith("ada", "card-pending");
    expect(reportConflicts).toHaveBeenCalledWith(["card-pending"]);
    expect(removeBook).toHaveBeenCalledWith("ada", "group-eng");
  });

  it("reconcileContactsSnapshot drops local rows missing from the remote list", async () => {
    readCache.mockResolvedValue({
      data: {
        cards: [remote, { ...remote, id: "card-stale", addressBookIds: { "group-gone": true } }],
        addressBooks: [
          defaultBook,
          { ...defaultBook, id: "group-gone", name: "Gone", isDefault: false },
        ],
      },
    });
    await reconcileContactsSnapshot("ada", [remote], [defaultBook]);
    expect(upsertBook).toHaveBeenCalledWith("ada", defaultBook);
    expect(upsert).toHaveBeenCalledWith("ada", remote, false);
    expect(remove).toHaveBeenCalledWith("ada", "card-stale");
    expect(removeBook).toHaveBeenCalledWith("ada", "group-gone");
  });
});
