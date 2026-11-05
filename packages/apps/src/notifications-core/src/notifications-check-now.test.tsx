/** @vitest-environment jsdom */
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeCrossTabBus } from "@/lib/jmap-client/push/mock/fake-cross-tab-bus";
import type { PresenceStore } from "@/presence-core/src/presence-store";
import { InboxFanOut, type InboxMessage } from "./inbox-fan-out";

const hub = vi.hoisted(() => {
  const state = { connected: false, statusListeners: new Set<(connected: boolean) => void>() };
  return {
    state,
    value: {
      get connected() {
        return state.connected;
      },
      leading: true,
      subscribe: () => () => undefined,
      subscribeStatus(listener: (connected: boolean) => void) {
        state.statusListeners.add(listener);
        return () => state.statusListeners.delete(listener);
      },
    },
  };
});
const fanOut = vi.hoisted(() => ({ here: null as InboxFanOut | null }));

vi.mock("@/lib/api/wgw/http", () => ({
  wgwHasAuthenticatedSession: vi.fn(() => true),
  wgwIsGuestSession: vi.fn(() => false),
}));
vi.mock("@/lib/api/wgw/notifications", () => ({
  listNotifications: vi.fn(),
  ackNotification: vi.fn(),
  ackLocalNotifications: vi.fn(),
}));
vi.mock("@/notifications-core/src/ensure-push-subscription", () => ({
  ensurePushPermissionAndSubscribe: vi.fn(async () => false),
}));
vi.mock("@/lib/api/wgw/jmap-push", () => ({ defaultJmapPushHub: () => hub.value }));
vi.mock("@/notifications-core/src/inbox-fan-out", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./inbox-fan-out")>()),
  defaultInboxFanOut: () => fanOut.here!,
}));

import { ackLocalNotifications, listNotifications } from "@/lib/api/wgw/notifications";
import { NotificationsProvider } from "@/notifications-core/src/notifications-provider";
import { PresenceStoreValueProvider } from "@/presence-core/src/presence-provider";

/** Only the part of the presence store the inbox uses. */
function fakeStore() {
  const listeners = new Set<() => void>();
  const store = {
    subscribeCheckNow: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as PresenceStore;
  return { store, checkNow: () => act(() => listeners.forEach((listener) => listener())) };
}

function setPushConnected(connected: boolean): void {
  hub.state.connected = connected;
  act(() => {
    for (const listener of hub.state.statusListeners) listener(connected);
  });
}

const listCalls = () => vi.mocked(listNotifications).mock.calls.length;

describe("inbox and a mesh check-now (#1662)", () => {
  beforeEach(() => {
    hub.state.connected = false;
    hub.state.statusListeners.clear();
    fanOut.here = new InboxFanOut({ topic: new FakeCrossTabBus<InboxMessage>().topic() });
    vi.mocked(listNotifications).mockReset();
    vi.mocked(listNotifications).mockResolvedValue({ list: [], unreadCount: 0 });
    vi.mocked(ackLocalNotifications).mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it("leaves a check-now to the push stream while push is connected", async () => {
    const { store, checkNow } = fakeStore();
    render(
      <PresenceStoreValueProvider store={store}>
        <NotificationsProvider />
      </PresenceStoreValueProvider>,
    );
    await waitFor(() => expect(listCalls()).toBe(1));
    setPushConnected(true);

    checkNow();
    await new Promise((resolve) => setTimeout(resolve, 1_300));

    // The hub reconnects instead; the `Notification` state then fetches the inbox.
    expect(listCalls()).toBe(1);
  });

  it("refreshes the inbox itself on a check-now while push is down", async () => {
    const { store, checkNow } = fakeStore();
    render(
      <PresenceStoreValueProvider store={store}>
        <NotificationsProvider />
      </PresenceStoreValueProvider>,
    );
    await waitFor(() => expect(listCalls()).toBe(1));

    checkNow();

    await waitFor(() => expect(listCalls()).toBeGreaterThan(1));
  });
});
