/** @vitest-environment jsdom */
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StateChangeListener } from "@/lib/jmap-client/push/state-change-subscription";
import type { InboxPayload } from "./inbox-fan-out";

const hub = vi.hoisted(() => {
  const state = {
    connected: false,
    leading: true,
    listeners: [] as Array<{ types: readonly string[]; listener: StateChangeListener }>,
    statusListeners: new Set<(connected: boolean) => void>(),
  };
  return {
    state,
    value: {
      get connected() {
        return state.connected;
      },
      get leading() {
        return state.leading;
      },
      subscribe(types: readonly string[], listener: StateChangeListener) {
        const entry = { types, listener };
        state.listeners.push(entry);
        return () => {
          state.listeners.splice(state.listeners.indexOf(entry), 1);
        };
      },
      subscribeStatus(listener: (connected: boolean) => void) {
        state.statusListeners.add(listener);
        return () => state.statusListeners.delete(listener);
      },
    },
  };
});

const fanOut = vi.hoisted(() => {
  const shared = new Set<(payload: InboxPayload) => void>();
  return {
    shared,
    value: {
      onShared(listener: (payload: InboxPayload) => void) {
        shared.add(listener);
        return () => shared.delete(listener);
      },
      share: vi.fn(),
    },
  };
});

vi.mock("@/lib/api/wgw/http", () => ({
  wgwHasAuthenticatedSession: vi.fn(() => true),
  wgwIsGuestSession: vi.fn(() => false),
}));
vi.mock("@/lib/api/wgw/notifications", () => ({
  listNotifications: vi.fn(),
  ackNotification: vi.fn(),
  ackLocalNotification: vi.fn(),
}));
vi.mock("@/notifications-core/src/ensure-push-subscription", () => ({
  ensurePushPermissionAndSubscribe: vi.fn(async () => false),
}));
vi.mock("@/lib/api/wgw/jmap-push", () => ({ defaultJmapPushHub: () => hub.value }));
vi.mock("@/notifications-core/src/inbox-fan-out", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./inbox-fan-out")>()),
  defaultInboxFanOut: () => fanOut.value,
}));

import { ackLocalNotification, listNotifications } from "@/lib/api/wgw/notifications";
import {
  NOTIFICATIONS_INBOX_POLL_MS,
  NOTIFICATIONS_INBOX_PUSH_POLL_MS,
  NotificationsProvider,
  useNotificationsInbox,
} from "@/notifications-core/src/notifications-provider";

const row = {
  id: "n1",
  domain: "chat",
  action: "message_posted",
  title: "Andrea sent you a direct message",
  body: "hi",
  navigate: "/meet/dms/alice",
  tag: "chat.message:1",
  readAt: null,
  createdAt: "2026-10-29T12:00:00Z",
};

const probe = { inbox: null as ReturnType<typeof useNotificationsInbox> };
function Probe() {
  probe.inbox = useNotificationsInbox();
  return null;
}

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
}

function notificationListener(): StateChangeListener {
  const entry = hub.state.listeners.find((item) => item.types.includes("Notification"));
  if (!entry) throw new Error("no Notification subscription");
  return entry.listener;
}

function setPushConnected(connected: boolean): void {
  hub.state.connected = connected;
  act(() => {
    for (const listener of hub.state.statusListeners) listener(connected);
  });
}

const listCalls = () => vi.mocked(listNotifications).mock.calls.length;

describe("notification inbox on push", () => {
  beforeEach(() => {
    probe.inbox = null;
    hub.state.connected = false;
    hub.state.listeners.length = 0;
    hub.state.statusListeners.clear();
    hub.state.leading = true;
    fanOut.value.share.mockReset();
    vi.mocked(listNotifications).mockReset();
    vi.mocked(ackLocalNotification).mockReset();
    vi.mocked(listNotifications).mockResolvedValue({ list: [], unreadCount: 0 });
    vi.mocked(ackLocalNotification).mockResolvedValue(undefined);
    setVisibility("visible");
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    setVisibility("visible");
  });

  it("subscribes to Notification only", async () => {
    render(<NotificationsProvider />);
    await waitFor(() => expect(listCalls()).toBe(1));
    expect(hub.state.listeners.map((entry) => entry.types)).toEqual([["Notification"]]);
  });

  it("a Notification state change fetches the inbox once in the tab that holds the stream and shares it", async () => {
    render(
      <NotificationsProvider>
        <Probe />
      </NotificationsProvider>,
    );
    await waitFor(() => expect(listCalls()).toBe(1));
    vi.mocked(listNotifications).mockResolvedValue({ list: [row], unreadCount: 1 });

    let confirmed: unknown;
    await act(async () => {
      confirmed = await notificationListener()({ Notification: "7" }, "member");
    });
    expect(confirmed).toBe(true);
    expect(listCalls()).toBe(2);
    expect(fanOut.value.share).toHaveBeenCalledTimes(1);
    expect(fanOut.value.share).toHaveBeenCalledWith({ list: [row], unreadCount: 1 });
    expect(probe.inbox?.items).toEqual([row]);
    expect(ackLocalNotification).toHaveBeenCalledTimes(1);
    expect(ackLocalNotification).toHaveBeenCalledWith("n1");
  });

  it("a failed fetch is not confirmed, so the server sends the change again", async () => {
    render(<NotificationsProvider />);
    await waitFor(() => expect(listCalls()).toBe(1));
    vi.mocked(listNotifications).mockRejectedValue(new TypeError("Failed to fetch"));
    let confirmed: unknown;
    await act(async () => {
      confirmed = await notificationListener()({ Notification: "7" }, "member");
    });
    expect(confirmed).toBe(false);
    expect(fanOut.value.share).not.toHaveBeenCalled();
  });

  it("a tab that does not hold the stream fetches nothing on push and shows the rows the leader shared", async () => {
    hub.state.leading = false;
    render(
      <NotificationsProvider>
        <Probe />
      </NotificationsProvider>,
    );
    await waitFor(() => expect(listCalls()).toBe(1));

    let confirmed: unknown;
    await act(async () => {
      confirmed = await notificationListener()({ Notification: "7" }, "member");
    });
    expect(confirmed).toBe(true);
    expect(listCalls()).toBe(1);

    act(() => {
      for (const listener of fanOut.shared) listener({ list: [row], unreadCount: 1 });
    });
    expect(probe.inbox?.items).toEqual([row]);
    expect(probe.inbox?.unreadCount).toBe(1);
    await waitFor(() => expect(ackLocalNotification).toHaveBeenCalledWith("n1"));

    act(() => {
      for (const listener of fanOut.shared) listener({ list: [row], unreadCount: 1 });
    });
    await Promise.resolve();
    expect(ackLocalNotification).toHaveBeenCalledTimes(1);
  });

  it("a hidden tab shows shared rows but does not ack them", async () => {
    hub.state.leading = false;
    setVisibility("hidden");
    render(
      <NotificationsProvider>
        <Probe />
      </NotificationsProvider>,
    );
    await waitFor(() => expect(listCalls()).toBe(1));
    act(() => {
      for (const listener of fanOut.shared) listener({ list: [row], unreadCount: 1 });
    });
    expect(probe.inbox?.items).toEqual([row]);
    await Promise.resolve();
    expect(ackLocalNotification).not.toHaveBeenCalled();
  });

  it("polls every 15 s while push is down and slows down while it is connected", async () => {
    vi.useFakeTimers();
    render(<NotificationsProvider />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(listCalls()).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(NOTIFICATIONS_INBOX_POLL_MS);
    });
    expect(listCalls()).toBe(2);

    setPushConnected(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(NOTIFICATIONS_INBOX_PUSH_POLL_MS - 1);
    });
    expect(listCalls()).toBe(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(listCalls()).toBe(3);

    setPushConnected(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(NOTIFICATIONS_INBOX_POLL_MS);
    });
    expect(listCalls()).toBe(4);
  });

  it("keeps the fallback poll below the 20 s local-ack grace", () => {
    expect(NOTIFICATIONS_INBOX_POLL_MS).toBeLessThan(20_000);
    expect(NOTIFICATIONS_INBOX_PUSH_POLL_MS).toBeGreaterThan(NOTIFICATIONS_INBOX_POLL_MS);
  });
});
