import { beforeEach, describe, expect, it, vi } from "vitest";
import { JmapContactsAdapter } from "./JmapContactsAdapter";
import { JmapMethodError } from "../core/errors.js";
import type { JmapClient } from "../core/JmapClient.js";
import { CONTACTS_CAPABILITY } from "../core/types.js";

const getAddressBooks = vi.fn();
const getContactCards = vi.fn();
const getContactCardsByQuery = vi.fn();
const addressBookChanges = vi.fn();
const contactCardChanges = vi.fn();

vi.mock("../contacts/JmapContactsClient.js", () => ({
  JmapContactsClient: class {
    getAddressBooks = getAddressBooks;
    getContactCards = getContactCards;
    getContactCardsByQuery = getContactCardsByQuery;
    addressBookChanges = addressBookChanges;
    contactCardChanges = contactCardChanges;
  },
}));

function clientStub(states: Record<string, string> = {}): JmapClient {
  const map = new Map(Object.entries(states));
  return {
    isConnected: true,
    connect: vi.fn(),
    primaryAccountId: (cap: string) => {
      expect(cap).toBe(CONTACTS_CAPABILITY);
      return "bob";
    },
    getState: (_account: string, type: string) => map.get(type),
    setState: (account: string, type: string, state: string) => {
      map.set(type, state);
      void account;
    },
  } as unknown as JmapClient;
}

describe("JmapContactsAdapter", () => {
  beforeEach(() => {
    getAddressBooks.mockReset();
    getContactCards.mockReset();
    getContactCardsByQuery.mockReset();
    addressBookChanges.mockReset();
    contactCardChanges.mockReset();
    getAddressBooks.mockResolvedValue({
      list: [{ id: "default", name: "Ada" }],
      state: "ab-1",
    });
    getContactCards.mockResolvedValue({
      list: [{ id: "c-1", addressBookIds: { default: true } }],
      state: "c-1",
    });
    getContactCardsByQuery.mockResolvedValue({
      list: [{ id: "c-new", addressBookIds: { "group-eng": true } }],
      state: "c-2",
    });
  });

  it("primes envelope state with empty ids so bootstrap is not re-listed", async () => {
    const onRemoteContactCard = vi.fn();
    const adapter = new JmapContactsAdapter({
      client: clientStub(),
      onRemoteContactCard,
    });
    await adapter.initialize();
    expect(getAddressBooks).toHaveBeenCalledWith("bob", []);
    expect(getContactCards).toHaveBeenCalledWith("bob", []);
    expect(onRemoteContactCard).not.toHaveBeenCalled();
  });

  it("polls AddressBook/changes then ContactCard/changes", async () => {
    const onRemoteContactCard = vi.fn();
    const onRemoteContactCardDestroyed = vi.fn();
    const onRemoteAddressBook = vi.fn();
    const adapter = new JmapContactsAdapter({
      client: clientStub({ AddressBook: "ab-1", ContactCard: "c-1" }),
      onRemoteContactCard,
      onRemoteContactCardDestroyed,
      onRemoteAddressBook,
    });
    addressBookChanges.mockResolvedValue({
      created: [],
      updated: [],
      destroyed: [],
      newState: "ab-2",
    });
    contactCardChanges.mockResolvedValue({
      created: ["c-2"],
      updated: [],
      destroyed: ["c-gone"],
      newState: "c-2",
    });
    getContactCards.mockResolvedValue({
      list: [{ id: "c-2", addressBookIds: { default: true } }],
      state: "c-2",
    });

    await adapter.sync();

    expect(addressBookChanges).toHaveBeenCalledWith("bob", "ab-1");
    expect(contactCardChanges).toHaveBeenCalledWith("bob", "c-1");
    expect(getContactCards).toHaveBeenCalledWith("bob", ["c-2"]);
    expect(onRemoteContactCard).toHaveBeenCalledWith({
      id: "c-2",
      addressBookIds: { default: true },
    });
    expect(onRemoteContactCardDestroyed).toHaveBeenCalledWith("c-gone");
    expect(addressBookChanges.mock.invocationCallOrder[0]).toBeLessThan(
      contactCardChanges.mock.invocationCallOrder[0]!,
    );
  });

  it("fetches cards for a newly created visible book", async () => {
    const onRemoteAddressBook = vi.fn();
    const onRemoteContactCard = vi.fn();
    const adapter = new JmapContactsAdapter({
      client: clientStub({ AddressBook: "ab-1", ContactCard: "c-1" }),
      onRemoteAddressBook,
      onRemoteContactCard,
    });
    addressBookChanges.mockResolvedValue({
      created: ["group-eng"],
      updated: [],
      destroyed: [],
      newState: "ab-2",
    });
    getAddressBooks.mockResolvedValue({
      list: [{ id: "group-eng", name: "Engineering" }],
      state: "ab-2",
    });
    contactCardChanges.mockResolvedValue({
      created: [],
      updated: [],
      destroyed: [],
      newState: "c-1",
    });

    await adapter.sync();

    expect(onRemoteAddressBook).toHaveBeenCalledWith({ id: "group-eng", name: "Engineering" });
    expect(getContactCardsByQuery).toHaveBeenCalledWith("bob", { inAddressBook: "group-eng" });
    expect(onRemoteContactCard).toHaveBeenCalledWith({
      id: "c-new",
      addressBookIds: { "group-eng": true },
    });
  });

  it("re-primes on cannotCalculateChanges", async () => {
    const adapter = new JmapContactsAdapter({
      client: clientStub({ AddressBook: "stale", ContactCard: "stale" }),
    });
    addressBookChanges.mockRejectedValue(
      new JmapMethodError("AddressBook/changes", "c0", { type: "cannotCalculateChanges" }),
    );
    await adapter.sync();
    expect(getAddressBooks).toHaveBeenCalled();
    expect(getContactCards).toHaveBeenCalled();
  });

  it("does not destroy a card that is also created or updated in the same delta", async () => {
    const onRemoteContactCard = vi.fn();
    const onRemoteContactCardDestroyed = vi.fn();
    const adapter = new JmapContactsAdapter({
      client: clientStub({ AddressBook: "ab-1", ContactCard: "c-1" }),
      onRemoteContactCard,
      onRemoteContactCardDestroyed,
    });
    addressBookChanges.mockResolvedValue({
      created: [],
      updated: [],
      destroyed: [],
      newState: "ab-2",
    });
    contactCardChanges.mockResolvedValue({
      created: ["c-moved"],
      updated: [],
      destroyed: ["c-moved"],
      newState: "c-2",
    });
    getContactCards.mockResolvedValue({
      list: [{ id: "c-moved", addressBookIds: { "group-eng": true } }],
      state: "c-2",
    });

    await adapter.sync();

    expect(onRemoteContactCard).toHaveBeenCalledWith(
      expect.objectContaining({ id: "c-moved", addressBookIds: { "group-eng": true } }),
    );
    expect(onRemoteContactCardDestroyed).not.toHaveBeenCalled();
  });

  it("hands a full snapshot to onRefetchAll after cannotCalculateChanges", async () => {
    const onRefetchAll = vi.fn();
    const adapter = new JmapContactsAdapter({
      client: clientStub({ ContactCard: "stale" }),
      onRefetchAll,
    });
    contactCardChanges.mockRejectedValue(
      new JmapMethodError("ContactCard/changes", "c0", { type: "cannotCalculateChanges" }),
    );
    await adapter.sync();
    expect(onRefetchAll).toHaveBeenCalledWith({
      books: [{ id: "default", name: "Ada" }],
      cards: [{ id: "c-1", addressBookIds: { default: true } }],
    });
  });
});
