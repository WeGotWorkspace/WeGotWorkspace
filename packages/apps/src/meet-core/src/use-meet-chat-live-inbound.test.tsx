/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JmapChatAdapter } from "@/lib/jmap-client";
import {
  StateChangeSubscription,
  type PushedState,
  type StateChangeListener,
} from "@/lib/jmap-client/push/state-change-subscription";
import {
  CHAT_CHANGES_POLL_MS,
  CHAT_CHANGES_PUSH_POLL_MS,
  useMeetChatLiveInbound,
} from "./use-meet-chat-live-inbound";

/**
 * Only the network is faked: the real adapter, `useJmapStateChange` and the
 * real per-subscription queue that collapses pushes, so "one coalesced sync"
 * is what production does.
 */
const mocks = vi.hoisted(() => ({
  states: new Map<string, string>(),
  channelChanges: vi.fn(),
  messageChanges: vi.fn(),
  getChannels: vi.fn(),
  getMessages: vi.fn(),
  ingestRemoteChatMessage: vi.fn(),
  ingestRemoteChatMessageDestroyed: vi.fn(),
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

vi.mock("@/lib/api/wgw/meet-chat-jmap", () => ({
  createMeetChatJmapClient: () => ({
    isConnected: true,
    connect: vi.fn(),
    primaryAccountId: () => "bob",
    getState: (_account: string, type: string) => mocks.states.get(type),
  }),
}));

vi.mock("@/lib/jmap-client/chat/JmapChatClient", () => ({
  JmapChatClient: class {
    getChannels = mocks.getChannels;
    getMessages = mocks.getMessages;
    channelChanges = mocks.channelChanges;
    messageChanges = mocks.messageChanges;
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

vi.mock("@/lib/offline/meet-chat/meet-chat-jmap-inbound", () => ({
  ingestRemoteChatMessage: mocks.ingestRemoteChatMessage,
  ingestRemoteChatMessageDestroyed: mocks.ingestRemoteChatMessageDestroyed,
  ingestRemoteChatChannel: vi.fn(async () => undefined),
  ingestRemoteChatChannelDestroyed: vi.fn(async () => undefined),
  reconcileMeetChatSnapshot: vi.fn(async () => undefined),
}));

vi.mock("@/lib/offline/meet-chat/meet-chat-offline-store", () => ({
  isChatChannelBackfilled: vi.fn(async () => true),
}));

vi.mock("@/lib/offline/meet-chat/meet-chat-inbound-sync", () => ({
  backfillChatChannelHistory: vi.fn(async () => undefined),
}));

const wireMessage = {
  id: "m-1",
  channelId: "general",
  authorId: "alice",
  authorName: "Alice",
  body: "hi",
  createdAt: "2026-11-04T10:00:00Z",
  reactions: [],
  mentions: [],
};

/** The server moved every channel's sync token to `state`; a message arrived and one was deleted. */
function serverMovedTo(state: string) {
  mocks.channelChanges.mockImplementation(async () => {
    mocks.states.set("ChatChannel", state);
    return { created: [], updated: [], destroyed: [], newState: state, hasMoreChanges: false };
  });
  mocks.messageChanges.mockImplementation(async () => {
    mocks.states.set("ChatMessage", state);
    return {
      created: ["m-1"],
      updated: [],
      destroyed: ["m-gone"],
      newState: state,
      hasMoreChanges: false,
    };
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
    useMeetChatLiveInbound({ username: "bob", enabled: true, patchFromCache }),
  );
  return { ...view, patchFromCache };
}

const subscribedTypes = () => mocks.hub!.subscriptions.map((s) => [...s.types].sort());

describe("useMeetChatLiveInbound", () => {
  beforeEach(() => {
    mocks.states = new Map([
      ["ChatChannel", "s1"],
      ["ChatMessage", "s1"],
    ]);
    mocks.hub = { connected: false, subscriptions: [], status: new Set() };
    mocks.getChannels.mockReset().mockResolvedValue({ list: [], state: "s1" });
    mocks.getMessages.mockReset().mockResolvedValue({ list: [wireMessage], state: "s1" });
    mocks.channelChanges.mockReset();
    mocks.messageChanges.mockReset();
    mocks.ingestRemoteChatMessage.mockReset().mockResolvedValue(undefined);
    mocks.ingestRemoteChatMessageDestroyed.mockReset().mockResolvedValue(undefined);
    serverMovedTo("s2");
  });

  it("subscribes to ChatChannel and ChatMessage once the adapter is ready", async () => {
    renderLiveInbound();
    await waitFor(() => expect(subscribedTypes()).toEqual([["ChatChannel", "ChatMessage"]]));
  });

  it("runs one coalesced sync for differing pushed states", async () => {
    const { patchFromCache } = renderLiveInbound();
    await waitFor(() => expect(subscribedTypes()).toHaveLength(1));

    // Both types in one push, and a second push in the same tick.
    push({ ChatChannel: "s2", ChatMessage: "s2" });
    push({ ChatMessage: "s2" });
    await settle();

    expect(mocks.channelChanges).toHaveBeenCalledTimes(1);
    expect(mocks.messageChanges).toHaveBeenCalledTimes(1);
    expect(mocks.getMessages).toHaveBeenLastCalledWith("bob", ["m-1"]);
    expect(mocks.ingestRemoteChatMessage).toHaveBeenCalledWith(
      "bob",
      expect.objectContaining({ id: "m-1", body: "hi" }),
    );
    expect(mocks.ingestRemoteChatMessageDestroyed).toHaveBeenCalledWith("bob", "m-gone");
    expect(patchFromCache).toHaveBeenCalled();
  });

  it("does not sync when the pushed states equal its own", async () => {
    renderLiveInbound();
    await waitFor(() => expect(subscribedTypes()).toHaveLength(1));

    push({ ChatChannel: "s1", ChatMessage: "s1" });
    await settle();

    expect(mocks.channelChanges).not.toHaveBeenCalled();
    expect(mocks.messageChanges).not.toHaveBeenCalled();
  });

  it("collapses pushes that arrive during a sync into one next sync", async () => {
    let release: () => void = () => undefined;
    mocks.channelChanges.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => {
            mocks.states.set("ChatChannel", "s2");
            resolve({ created: [], updated: [], destroyed: [], newState: "s2" });
          };
        }),
    );
    mocks.messageChanges.mockImplementationOnce(async () => {
      mocks.states.set("ChatMessage", "s2");
      return { created: [], updated: [], destroyed: [], newState: "s2" };
    });
    renderLiveInbound();
    await waitFor(() => expect(subscribedTypes()).toHaveLength(1));

    push({ ChatChannel: "s2", ChatMessage: "s2" });
    await settle();
    // While the first round runs, two newer states arrive.
    serverMovedTo("s4");
    push({ ChatMessage: "s3" });
    await settle();
    push({ ChatMessage: "s4" });
    release();
    await settle();

    expect(mocks.channelChanges).toHaveBeenCalledTimes(2);
    expect(mocks.messageChanges).toHaveBeenCalledTimes(2);
  });

  it("polls every 4 s without push and slower while push is connected", async () => {
    const startPolling = vi.spyOn(JmapChatAdapter.prototype, "startPolling");
    renderLiveInbound();
    await waitFor(() => expect(startPolling).toHaveBeenCalledWith(CHAT_CHANGES_POLL_MS));
    expect(CHAT_CHANGES_POLL_MS).toBe(4_000);
    expect(CHAT_CHANGES_PUSH_POLL_MS).toBeGreaterThan(CHAT_CHANGES_POLL_MS);

    mocks.hub!.connected = true;
    act(() => mocks.hub!.status.forEach((listener) => listener()));
    expect(startPolling).toHaveBeenLastCalledWith(CHAT_CHANGES_PUSH_POLL_MS);

    // Push drops (rate limit, offline): back to the chat cadence.
    mocks.hub!.connected = false;
    act(() => mocks.hub!.status.forEach((listener) => listener()));
    expect(startPolling).toHaveBeenLastCalledWith(CHAT_CHANGES_POLL_MS);
    startPolling.mockRestore();
  });

  it("does not subscribe without the chat capability", async () => {
    mocks.getChannels.mockRejectedValue(new Error("no chat capability"));
    renderLiveInbound();
    await settle();
    expect(subscribedTypes()).toEqual([]);
  });

  it("does not run while disabled", async () => {
    renderHook(() =>
      useMeetChatLiveInbound({ username: "bob", enabled: false, patchFromCache: vi.fn() }),
    );
    await settle();
    expect(mocks.getChannels).not.toHaveBeenCalled();
    expect(subscribedTypes()).toEqual([]);
  });
});
