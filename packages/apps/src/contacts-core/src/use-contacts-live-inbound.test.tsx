/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JmapContactsAdapter } from "@/lib/jmap-client";
import {
  StateChangeSubscription,
  type PushedState,
  type StateChangeListener,
} from "@/lib/jmap-client/push/state-change-subscription";
import {
  CONTACTS_CHANGES_POLL_MS,
  CONTACTS_CHANGES_PUSH_POLL_MS,
  useContactsLiveInbound,
} from "./use-contacts-live-inbound";

/**
 * Only the network is faked: the real adapter, `useJmapStateChange` and the
 * real per-subscription queue that collapses pushes, so "one coalesced sync"
 * is what production does.
 */
const mocks = vi.hoisted(() => ({
  states: new Map<string, string>(),
  addressBookChanges: vi.fn(),
  contactCardChanges: vi.fn(),
  getAddressBooks: vi.fn(),
  getContactCards: vi.fn(),
  ingestRemoteContactCard: vi.fn(),
  ingestRemoteContactCardDestroyed: vi.fn(),
  hub: null as null | {
    connected: boolean;
    subscriptions: StateChangeSubscription[];
    status: Set<() => void>;
  },
}));

vi.mock("@/lib/api/wgw/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/wgw/http")>();
  return { ...actual, wgwLiveApiEnabled: () => true };
});

vi.mock("@/lib/api/wgw/contacts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/wgw/contacts")>();
  return {
    ...actual,
    createContactsJmapClient: () => ({
      isConnected: true,
      connect: vi.fn(),
      primaryAccountId: () => "bob",
      getState: (_account: string, type: string) => mocks.states.get(type),
    }),
  };
});

vi.mock("@/lib/jmap-client/contacts/JmapContactsClient", () => ({
  JmapContactsClient: class {
    getAddressBooks = mocks.getAddressBooks;
    getContactCards = mocks.getContactCards;
    addressBookChanges = mocks.addressBookChanges;
    contactCardChanges = mocks.contactCardChanges;
  },
}));

vi.mock("@/lib/api/wgw/jmap-push", () => ({
  defaultJmapPushHub: () => {
    const hub = mocks.hub!;
    return {
      get connected() {
        return hub.connected;
      },
      subscribe(types: readonly string[], listener: StateChangeListener) {
        const subscription = new StateChangeSubscription(types, listener, () => undefined);
        hub.subscriptions.push(subscription);
        return () => {
          subscription.dispose();
          hub.subscriptions = hub.subscriptions.filter((s) => s !== subscription);
        };
      },
      subscribeStatus(listener: () => void) {
        hub.status.add(listener);
        return () => hub.status.delete(listener);
      },
    };
  },
}));

vi.mock("@/lib/offline/contacts-jmap-inbound", () => ({
  ingestRemoteContactCard: mocks.ingestRemoteContactCard,
  ingestRemoteContactCardDestroyed: mocks.ingestRemoteContactCardDestroyed,
  ingestRemoteAddressBook: vi.fn(async () => undefined),
  ingestRemoteAddressBookDestroyed: vi.fn(async () => undefined),
  reconcileContactsSnapshot: vi.fn(async () => undefined),
}));

/** The server moved every book's sync token to `state`; a card changed and one was deleted. */
function serverMovedTo(state: string) {
  mocks.addressBookChanges.mockImplementation(async () => {
    mocks.states.set("AddressBook", state);
    return { created: [], updated: [], destroyed: [] };
  });
  mocks.contactCardChanges.mockImplementation(async () => {
    mocks.states.set("ContactCard", state);
    return { created: [], updated: ["c-1"], destroyed: ["c-gone"] };
  });
}

function push(states: Record<string, string>) {
  const pushed: Record<string, PushedState> = {};
  for (const [type, state] of Object.entries(states)) pushed[type] = { state, hash: null };
  for (const subscription of mocks.hub!.subscriptions) subscription.offer("bob", pushed);
}

/** Lets queued pushes run their sync and the ingests settle. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

function renderLiveInbound(patchFromCache = vi.fn(async () => undefined)) {
  const view = renderHook(() =>
    useContactsLiveInbound({ username: "bob", enabled: true, patchFromCache }),
  );
  return { ...view, patchFromCache };
}

const subscribedTypes = () => mocks.hub!.subscriptions.map((s) => [...s.types].sort());

describe("useContactsLiveInbound", () => {
  beforeEach(() => {
    mocks.states = new Map([
      ["AddressBook", "s1"],
      ["ContactCard", "s1"],
    ]);
    mocks.hub = { connected: false, subscriptions: [], status: new Set() };
    mocks.getAddressBooks.mockReset().mockResolvedValue({ list: [], state: "s1" });
    mocks.getContactCards.mockReset().mockResolvedValue({ list: [{ id: "c-1" }], state: "s1" });
    mocks.addressBookChanges.mockReset();
    mocks.contactCardChanges.mockReset();
    mocks.ingestRemoteContactCard.mockReset().mockResolvedValue(undefined);
    mocks.ingestRemoteContactCardDestroyed.mockReset().mockResolvedValue(undefined);
    serverMovedTo("s2");
  });

  it("subscribes to AddressBook and ContactCard once the adapter is ready", async () => {
    renderLiveInbound();
    await waitFor(() => expect(subscribedTypes()).toEqual([["AddressBook", "ContactCard"]]));
  });

  it("runs one coalesced sync for differing pushed states", async () => {
    const { patchFromCache } = renderLiveInbound();
    await waitFor(() => expect(subscribedTypes()).toHaveLength(1));

    // Both types in one push, and a second push in the same tick.
    push({ AddressBook: "s2", ContactCard: "s2" });
    push({ ContactCard: "s2" });
    await settle();

    expect(mocks.addressBookChanges).toHaveBeenCalledTimes(1);
    expect(mocks.contactCardChanges).toHaveBeenCalledTimes(1);
    expect(mocks.ingestRemoteContactCard).toHaveBeenCalledWith("bob", { id: "c-1" });
    expect(mocks.ingestRemoteContactCardDestroyed).toHaveBeenCalledWith("bob", "c-gone");
    expect(patchFromCache).toHaveBeenCalled();
  });

  it("does not sync when the pushed states equal its own", async () => {
    renderLiveInbound();
    await waitFor(() => expect(subscribedTypes()).toHaveLength(1));

    push({ AddressBook: "s1", ContactCard: "s1" });
    await settle();

    expect(mocks.addressBookChanges).not.toHaveBeenCalled();
    expect(mocks.contactCardChanges).not.toHaveBeenCalled();
  });

  it("collapses pushes that arrive during a sync into one next sync", async () => {
    let release: () => void = () => undefined;
    mocks.addressBookChanges.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => {
            mocks.states.set("AddressBook", "s2");
            resolve({ created: [], updated: [], destroyed: [] });
          };
        }),
    );
    mocks.contactCardChanges.mockImplementationOnce(async () => {
      mocks.states.set("ContactCard", "s2");
      return { created: [], updated: [], destroyed: [] };
    });
    renderLiveInbound();
    await waitFor(() => expect(subscribedTypes()).toHaveLength(1));

    push({ AddressBook: "s2", ContactCard: "s2" });
    await settle();
    // While the first round runs, two newer states arrive.
    serverMovedTo("s4");
    push({ ContactCard: "s3" });
    await settle();
    push({ ContactCard: "s4" });
    release();
    await settle();

    expect(mocks.addressBookChanges).toHaveBeenCalledTimes(2);
    expect(mocks.contactCardChanges).toHaveBeenCalledTimes(2);
  });

  it("polls every 10 s without push and every 60 s while push is connected", async () => {
    const startPolling = vi.spyOn(JmapContactsAdapter.prototype, "startPolling");
    renderLiveInbound();
    await waitFor(() => expect(startPolling).toHaveBeenCalledWith(CONTACTS_CHANGES_POLL_MS));

    mocks.hub!.connected = true;
    act(() => mocks.hub!.status.forEach((listener) => listener()));

    expect(startPolling).toHaveBeenLastCalledWith(CONTACTS_CHANGES_PUSH_POLL_MS);
    startPolling.mockRestore();
  });

  it("does not subscribe without the contacts capability", async () => {
    mocks.getAddressBooks.mockRejectedValue(new Error("no contacts capability"));
    renderLiveInbound();
    await settle();
    expect(subscribedTypes()).toEqual([]);
  });

  it("does not run while disabled", async () => {
    renderHook(() =>
      useContactsLiveInbound({ username: "bob", enabled: false, patchFromCache: vi.fn() }),
    );
    await settle();
    expect(mocks.getAddressBooks).not.toHaveBeenCalled();
    expect(subscribedTypes()).toEqual([]);
  });
});
