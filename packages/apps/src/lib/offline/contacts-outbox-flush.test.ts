import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContactsAppBootstrap } from "@/lib/api/mock/contacts-bootstrap";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import type { ContactCard } from "@/contacts-core/src/contacts-types";
import {
  enqueueCoalescedContactUpdate,
  enqueueOutboxMutation,
  listOutboxMutations,
  writeContactsBootstrapToCache,
} from "@/lib/offline/contacts-offline-store";
import { CONTACTS_DOMAIN } from "@/lib/offline/contacts/contacts-schema";
import { flushContactsOutbox } from "@/lib/offline/contacts-outbox-flush";

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

const { contactCardSet, getCard, patchAddressBook, pullAddressBookChanges, syncAllContactBooks } =
  vi.hoisted(() => ({
    contactCardSet: vi.fn(),
    getCard: vi.fn(),
    patchAddressBook: vi.fn(),
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
  patchAddressBook,
  listAddressBooks: vi.fn().mockResolvedValue([
    {
      id: "default",
      name: "Default",
      sortOrder: 0,
      isDefault: true,
      isSubscribed: true,
      isSharee: false,
      myRights: { mayRead: true, mayWrite: true, mayShare: false, mayDelete: true },
    },
  ]),
}));

vi.mock("@/lib/api/wgw/contacts-sync", () => ({
  pullAddressBookChanges,
  syncAllContactBooks,
}));

describe("flushContactsOutbox", () => {
  beforeEach(async () => {
    contactCardSet.mockReset();
    getCard.mockReset();
    patchAddressBook.mockReset();
    pullAddressBookChanges.mockReset();
    pullAddressBookChanges.mockResolvedValue(undefined);
    syncAllContactBooks.mockReset();
    syncAllContactBooks.mockResolvedValue(undefined);
    await writeContactsBootstrapToCache(username, bootstrap);
  });

  it("flushes a coalesced offline update once with the original ifInState", async () => {
    await enqueueCoalescedContactUpdate(
      username,
      "jane-doe",
      { name: { "@type": "Name", isOrdered: false, full: "Jane A" } },
      "state-1",
    );
    await enqueueCoalescedContactUpdate(
      username,
      "jane-doe",
      { name: { "@type": "Name", isOrdered: false, full: "Jane B" } },
      "state-1",
    );

    contactCardSet.mockResolvedValue({
      created: {},
      updated: { "jane-doe": null },
      destroyed: {},
      notCreated: {},
      notUpdated: {},
      notDestroyed: {},
    });
    getCard.mockResolvedValue({
      ...bootstrap.data.cards[0],
      name: { "@type": "Name", isOrdered: false, full: "Jane B" },
      state: "state-2",
    });

    const result = await flushContactsOutbox(username);

    expect(result.stateMismatches).toEqual([]);
    expect(contactCardSet).toHaveBeenCalledTimes(1);
    expect(contactCardSet.mock.calls[0]?.[0]).toEqual({
      update: {
        "jane-doe": {
          name: { "@type": "Name", isOrdered: false, full: "Jane B" },
          ifInState: "state-1",
        },
      },
    });
  });

  it("returns stateMismatches when the server rejects stale ifInState", async () => {
    await enqueueCoalescedContactUpdate(
      username,
      "jane-doe",
      { name: { "@type": "Name", isOrdered: false, full: "Jane B" } },
      "state-1",
    );

    contactCardSet.mockResolvedValue({
      created: {},
      updated: {},
      destroyed: {},
      notCreated: {},
      notUpdated: {
        "jane-doe": { type: "stateMismatch", description: "stale" },
      },
      notDestroyed: {},
    });

    const result = await flushContactsOutbox(username);

    expect(result.stateMismatches).toEqual(["jane-doe"]);
    expect(getCard).not.toHaveBeenCalled();
  });

  it("drops a notFound card update as a conflict and does not retry", async () => {
    await enqueueCoalescedContactUpdate(
      username,
      "jane-doe",
      { name: { "@type": "Name", isOrdered: false, full: "Jane B" } },
      "state-1",
    );

    contactCardSet.mockResolvedValue({
      created: {},
      updated: {},
      destroyed: {},
      notCreated: {},
      notUpdated: {
        "jane-doe": { type: "notFound", description: "Address book gone" },
      },
      notDestroyed: {},
    });

    const result = await flushContactsOutbox(username);

    expect(result.stateMismatches).toEqual(["jane-doe"]);
    expect(getCard).not.toHaveBeenCalled();
    await expect(listOutboxMutations(username)).resolves.toHaveLength(0);
  });

  it("flushes bookUpdate via AddressBook/set", async () => {
    const shareWith = {
      alice: { mayRead: true, mayWrite: true, mayShare: false, mayDelete: false },
    };
    await enqueueOutboxMutation(username, {
      id: crypto.randomUUID(),
      domain: CONTACTS_DOMAIN,
      op: "bookUpdate",
      payload: JSON.stringify({
        addressBookId: "default",
        patch: { shareWith, isSubscribed: true },
      }),
    });
    patchAddressBook.mockResolvedValue({
      ...bootstrap.data.addressBooks[0],
      shareWith,
    });

    const result = await flushContactsOutbox(username);

    expect(result.stateMismatches).toEqual([]);
    expect(patchAddressBook).toHaveBeenCalledWith("default", { shareWith, isSubscribed: true });
    await expect(listOutboxMutations(username)).resolves.toHaveLength(0);
  });

  it("sends a patch merged in while the first one was on its way (#1711)", async () => {
    const named = (full: string) => ({
      name: { "@type": "Name" as const, isOrdered: false, full },
    });
    await enqueueCoalescedContactUpdate(username, "jane-doe", named("Jane A"), "state-1");
    const answer = (state: string) => ({
      created: {},
      updated: { "jane-doe": state },
      destroyed: [],
      notCreated: {},
      notUpdated: {},
      notDestroyed: {},
    });
    let answerFirst!: (value: unknown) => void;
    contactCardSet.mockReturnValueOnce(new Promise((resolve) => (answerFirst = resolve)));
    contactCardSet.mockResolvedValueOnce(answer("state-3"));
    getCard.mockResolvedValue({ ...bootstrap.data.cards[0], ...named("Jane B") });

    const flushing = flushContactsOutbox(username);
    await vi.waitFor(() => expect(contactCardSet).toHaveBeenCalledOnce());
    await enqueueCoalescedContactUpdate(username, "jane-doe", named("Jane B"), "state-1");
    answerFirst(answer("state-2"));
    await flushing;

    expect(contactCardSet).toHaveBeenCalledTimes(2);
    expect(contactCardSet.mock.calls[1]?.[0]).toEqual({
      update: { "jane-doe": { ...named("Jane B"), ifInState: "state-2" } },
    });
    await expect(listOutboxMutations(username)).resolves.toHaveLength(0);
  });
});
