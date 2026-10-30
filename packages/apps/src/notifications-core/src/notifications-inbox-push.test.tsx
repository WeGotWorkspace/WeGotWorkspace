/** @vitest-environment jsdom */
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StateChangeListener } from "@/lib/jmap-client/push/state-change-subscription";
import { FakeCrossTabBus } from "@/lib/jmap-client/push/mock/fake-cross-tab-bus";
import { InboxFanOut, type InboxMessage } from "./inbox-fan-out";

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

/** This tab's fan-out and another tab's, on one fake BroadcastChannel. */
const tabs = vi.hoisted(() => ({
  here: null as InboxFanOut | null,
  other: null as InboxFanOut | null,
}));

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
  defaultInboxFanOut: () => tabs.here!,
}));

import { ackLocalNotification, listNotifications } from "@/lib/api/wgw/notifications";
import { INBOX_SHARE_WAIT_MS } from "@/notifications-core/src/use-notifications-inbox-push";
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

/** Let cross-tab messages (one task each) and React effects run. */
const settle = () =>
  act(async () => {
    for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

describe("notification inbox on push", () => {
  beforeEach(() => {
    probe.inbox = null;
    hub.state.connected = false;
    hub.state.listeners.length = 0;
    hub.state.statusListeners.clear();
    hub.state.leading = true;
    const bus = new FakeCrossTabBus<InboxMessage>();
    tabs.here = new InboxFanOut({ topic: bus.topic() });
    tabs.other = new InboxFanOut({ topic: bus.topic() });
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
    const inOther = tabs.other!.waitFor("7", INBOX_SHARE_WAIT_MS);

    let confirmed: unknown;
    await act(async () => {
      confirmed = await notificationListener()({ Notification: "7" }, "member");
    });
    expect(confirmed).toBe(true);
    expect(listCalls()).toBe(2);
    await expect(inOther).resolves.toEqual({ list: [row], unreadCount: 1 });
    expect(probe.inbox?.items).toEqual([row]);
    expect(ackLocalNotification).toHaveBeenCalledTimes(1);
    expect(ackLocalNotification).toHaveBeenCalledWith("n1");
  });

  it("a failed fetch is not confirmed, and the other tabs hear that it failed", async () => {
    render(<NotificationsProvider />);
    await waitFor(() => expect(listCalls()).toBe(1));
    vi.mocked(listNotifications).mockRejectedValue(new TypeError("Failed to fetch"));
    const inOther = tabs.other!.waitFor("7", INBOX_SHARE_WAIT_MS);
    let confirmed: unknown;
    await act(async () => {
      confirmed = await notificationListener()({ Notification: "7" }, "member");
    });
    expect(confirmed).toBe(false);
    await expect(inOther).resolves.toBeNull();
  });

  it("a refresh started while the push fetch runs does not cancel it", async () => {
    render(<NotificationsProvider />);
    await waitFor(() => expect(listCalls()).toBe(1));
    const pushGet = deferred<{ list: (typeof row)[]; unreadCount: number }>();
    vi.mocked(listNotifications)
      .mockReturnValueOnce(pushGet.promise)
      .mockResolvedValue({ list: [row], unreadCount: 1 });
    const inOther = tabs.other!.waitFor("7", INBOX_SHARE_WAIT_MS);

    let confirmed: unknown = "pending";
    const listener = notificationListener()({ Notification: "7" }, "member");
    void Promise.resolve(listener).then((value) => (confirmed = value));
    await waitFor(() => expect(listCalls()).toBe(2));
    // The tab becomes visible again: its own refresh starts and would abort the push GET.
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(listCalls()).toBe(3));
    await act(async () => {
      pushGet.resolve({ list: [row], unreadCount: 1 });
      await listener;
    });
    expect(confirmed).toBe(true);
    await expect(inOther).resolves.toEqual({ list: [row], unreadCount: 1 });
  });

  it("a tab that does not hold the stream fetches nothing and confirms only once it has the shared rows", async () => {
    hub.state.leading = false;
    render(
      <NotificationsProvider>
        <Probe />
      </NotificationsProvider>,
    );
    await waitFor(() => expect(listCalls()).toBe(1));

    let confirmed: unknown = "pending";
    const listener = notificationListener()({ Notification: "7" }, "member");
    void Promise.resolve(listener).then((value) => (confirmed = value));
    await settle();
    expect(confirmed).toBe("pending");
    expect(listCalls()).toBe(1);

    tabs.other!.share({ list: [row], unreadCount: 1 }, "7");
    await settle();
    expect(confirmed).toBe(true);
    expect(probe.inbox?.items).toEqual([row]);
    expect(probe.inbox?.unreadCount).toBe(1);
    await waitFor(() => expect(ackLocalNotification).toHaveBeenCalledWith("n1"));

    tabs.other!.share({ list: [row], unreadCount: 1 }, "8");
    await settle();
    expect(ackLocalNotification).toHaveBeenCalledTimes(1);
  });

  it("a tab that does not hold the stream does not confirm when the fetching tab failed", async () => {
    hub.state.leading = false;
    render(<NotificationsProvider />);
    await waitFor(() => expect(listCalls()).toBe(1));
    let confirmed: unknown = "pending";
    const listener = notificationListener()({ Notification: "7" }, "member");
    void Promise.resolve(listener).then((value) => (confirmed = value));
    tabs.other!.shareFailed("7");
    await settle();
    expect(confirmed).toBe(false);
  });

  it("a tab that does not hold the stream gives up when nothing is shared (the fetching tab went away)", async () => {
    hub.state.leading = false;
    vi.useFakeTimers();
    render(<NotificationsProvider />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    let confirmed: unknown = "pending";
    const listener = notificationListener()({ Notification: "7" }, "member");
    void Promise.resolve(listener).then((value) => (confirmed = value));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INBOX_SHARE_WAIT_MS - 1);
    });
    expect(confirmed).toBe("pending");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(confirmed).toBe(false);
  });

  it("a tab that took over the stream while it waited fetches and shares the rows itself", async () => {
    hub.state.leading = false;
    vi.useFakeTimers();
    render(<NotificationsProvider />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(listCalls()).toBe(1);
    vi.mocked(listNotifications).mockResolvedValue({ list: [row], unreadCount: 1 });
    const inOther = tabs.other!.waitFor("7", INBOX_SHARE_WAIT_MS * 2);

    let confirmed: unknown = "pending";
    const listener = notificationListener()({ Notification: "7" }, "member");
    void Promise.resolve(listener).then((value) => (confirmed = value));
    hub.state.leading = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INBOX_SHARE_WAIT_MS);
    });
    expect(confirmed).toBe(true);
    expect(listCalls()).toBe(2);
    // The fake channel delivers on a timer too (fake timers clamp it to a few ms).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    await expect(inOther).resolves.toEqual({ list: [row], unreadCount: 1 });
  });

  it("an older shared inbox marker does not replace rows of a higher one", async () => {
    hub.state.leading = false;
    render(
      <NotificationsProvider>
        <Probe />
      </NotificationsProvider>,
    );
    await waitFor(() => expect(listCalls()).toBe(1));
    tabs.other!.share({ list: [row], unreadCount: 1 }, "10");
    await settle();
    expect(probe.inbox?.items).toEqual([row]);
    tabs.other!.share({ list: [], unreadCount: 0 }, "9");
    await settle();
    expect(probe.inbox?.items).toEqual([row]);
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
    tabs.other!.share({ list: [row], unreadCount: 1 }, "7");
    await settle();
    expect(probe.inbox?.items).toEqual([row]);
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
