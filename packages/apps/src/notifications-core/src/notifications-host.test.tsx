/** @vitest-environment jsdom */
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/wgw/http", () => ({
  wgwHasAuthenticatedSession: vi.fn(() => true),
  wgwIsGuestSession: vi.fn(() => false),
}));

vi.mock("@/lib/api/wgw/notifications", () => ({
  listNotifications: vi.fn(async () => ({ list: [], unreadCount: 0 })),
  ackNotification: vi.fn(),
  ackLocalNotification: vi.fn(),
  fetchVapidPublicKey: vi.fn(),
  subscribePush: vi.fn(),
}));

vi.mock("@/notifications-core/src/ensure-push-subscription", () => ({
  ensurePushPermissionAndSubscribe: vi.fn(async () => false),
}));

vi.mock("@/notifications-core/src/notification-click-navigate", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/notifications-core/src/notification-click-navigate")>();
  return {
    ...actual,
    assignNotificationNavigate: vi.fn(),
  };
});

import { wgwHasAuthenticatedSession, wgwIsGuestSession } from "@/lib/api/wgw/http";
import { ackLocalNotification, ackNotification, listNotifications } from "@/lib/api/wgw/notifications";
import { ensurePushPermissionAndSubscribe } from "@/notifications-core/src/ensure-push-subscription";
import {
  assignNotificationNavigate,
  WGW_NOTIFICATION_NAVIGATE_MESSAGE,
} from "@/notifications-core/src/notification-click-navigate";
import {
  NotificationsHost,
  NotificationsProvider,
  NOTIFICATIONS_INBOX_POLL_MS,
  useNotificationsInbox,
} from "@/notifications-core/src/notifications-provider";
import { PresenceStoreValueProvider } from "@/presence-core/src/presence-provider";
import { createPresenceStore } from "@/presence-core/src/presence-store";
import type {
  PresenceEnvelope,
  PresenceMeshEvent,
  PresenceMeshSession,
} from "@/presence-core/src/presence-types";
import type { RtcPeerDescriptor } from "@/lib/rtc/types";

class FakeSession implements PresenceMeshSession {
  peers: RtcPeerDescriptor[] = [];
  private readonly listeners = new Set<(event: PresenceMeshEvent) => void>();

  async join(): Promise<{ peerId: string }> {
    return { peerId: "self" };
  }
  async leave(): Promise<void> {}
  broadcast(_envelope: PresenceEnvelope): void {}
  sendTo(_peerId: string, _envelope: PresenceEnvelope): void {}
  getRoomPeers(): RtcPeerDescriptor[] {
    return this.peers;
  }
  onEvent(listener: (event: PresenceMeshEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  emit(event: PresenceMeshEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

const unreadItem = {
  id: "n1",
  domain: "chat",
  action: "message_posted",
  title: "Andrea sent you a direct message",
  body: "hi",
  navigate: "/meet/dms/alice",
  tag: "chat.message:1",
  readAt: null,
  createdAt: "2026-09-13T12:00:00Z",
};

describe("NotificationsHost", () => {
  beforeEach(() => {
    vi.mocked(wgwHasAuthenticatedSession).mockReturnValue(true);
    vi.mocked(wgwIsGuestSession).mockReturnValue(false);
    vi.mocked(ensurePushPermissionAndSubscribe).mockClear();
    vi.mocked(listNotifications).mockReset();
    vi.mocked(ackLocalNotification).mockReset();
    vi.mocked(ackNotification).mockReset();
    vi.mocked(assignNotificationNavigate).mockReset();
    vi.mocked(listNotifications).mockResolvedValue({ list: [], unreadCount: 0 });
    vi.mocked(ackLocalNotification).mockResolvedValue(undefined);
    vi.mocked(ackNotification).mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  it("polls the inbox every 15s, shorter than the 20s local-ack grace", () => {
    expect(NOTIFICATIONS_INBOX_POLL_MS).toBe(15_000);
    expect(NOTIFICATIONS_INBOX_POLL_MS).toBeLessThan(20_000);
  });

  it("refreshes the inbox on the 15s poll interval", async () => {
    vi.useFakeTimers();
    render(<NotificationsHost />);
    const baseline = vi.mocked(listNotifications).mock.calls.length;
    expect(baseline).toBeGreaterThanOrEqual(1);
    expect(listNotifications).toHaveBeenCalledWith(
      expect.objectContaining({ unread: true }),
    );

    await vi.advanceTimersByTimeAsync(NOTIFICATIONS_INBOX_POLL_MS - 1);
    expect(listNotifications).toHaveBeenCalledTimes(baseline);

    await vi.advanceTimersByTimeAsync(1);
    expect(listNotifications).toHaveBeenCalledTimes(baseline + 1);
  });

  it("requests unread-only inbox rows for the bell tray", async () => {
    render(<NotificationsHost />);
    await waitFor(() => {
      expect(listNotifications).toHaveBeenCalledWith(
        expect.objectContaining({ unread: true }),
      );
    });
  });

  it("refreshes the inbox immediately on inbound notify-hint", async () => {
    const session = new FakeSession();
    const store = createPresenceStore({
      createSession: () => session,
      joinMode: "eager",
      visibility: null,
    });
    store.start({ username: "alice", displayName: "Alice" });
    await Promise.resolve();
    session.peers = [{ id: "bob-1", name: "Bob", user: "bob" }];
    session.emit({ type: "roster" });

    render(
      <PresenceStoreValueProvider store={store}>
        <NotificationsHost />
      </PresenceStoreValueProvider>,
    );
    await waitFor(() => {
      expect(listNotifications).toHaveBeenCalled();
    });
    const baseline = vi.mocked(listNotifications).mock.calls.length;

    vi.useFakeTimers();
    session.emit({
      type: "envelope",
      peerId: "bob-1",
      envelope: { v: 1, kind: "notify-hint", tag: "chat.message_posted" },
    });

    // Immediate hint GET + scheduled retries at 300ms and 1200ms.
    expect(listNotifications.mock.calls.length).toBeGreaterThan(baseline);
    await vi.advanceTimersByTimeAsync(1_200);
    expect(listNotifications.mock.calls.length).toBeGreaterThanOrEqual(baseline + 3);
  });

  it("does not let a slow in-flight GET overwrite a newer notify-hint refresh", async () => {
    let resolveSlow: ((value: { list: typeof unreadItem[]; unreadCount: number }) => void) | null =
      null;
    let call = 0;
    vi.mocked(listNotifications).mockImplementation(() => {
      call += 1;
      if (call === 1) {
        // Mount refresh — hang until after the hint so we can prove abort/ignore.
        return new Promise((resolve) => {
          resolveSlow = resolve;
        });
      }
      return Promise.resolve({ list: [unreadItem], unreadCount: 1 });
    });

    const session = new FakeSession();
    const store = createPresenceStore({
      createSession: () => session,
      joinMode: "eager",
      visibility: null,
    });
    store.start({ username: "alice", displayName: "Alice" });
    await Promise.resolve();
    session.peers = [{ id: "bob-1", name: "Bob", user: "bob" }];
    session.emit({ type: "roster" });

    let inbox: ReturnType<typeof useNotificationsInbox> = null;
    function Probe() {
      inbox = useNotificationsInbox();
      return null;
    }

    render(
      <PresenceStoreValueProvider store={store}>
        <NotificationsProvider>
          <Probe />
        </NotificationsProvider>
      </PresenceStoreValueProvider>,
    );

    await waitFor(() => {
      expect(call).toBe(1);
      expect(resolveSlow).not.toBeNull();
    });

    session.emit({
      type: "envelope",
      peerId: "bob-1",
      envelope: { v: 1, kind: "notify-hint", tag: "chat.message_posted" },
    });

    await waitFor(() => {
      expect(inbox?.unreadCount).toBe(1);
      expect(inbox?.items).toHaveLength(1);
    });

    // Slow mount GET resolves empty after abort — must not wipe the hint result.
    resolveSlow?.({ list: [], unreadCount: 0 });
    await Promise.resolve();
    expect(inbox?.unreadCount).toBe(1);
    expect(inbox?.items).toHaveLength(1);
  });

  it("does not render a viewport overlay bell (AppSidebar owns the tray)", () => {
    const { container } = render(<NotificationsHost />);
    expect(container.querySelector(".notification-inbox-host")).toBeNull();
    expect(container.querySelector(".notification-inbox-tray__trigger")).toBeNull();
  });

  it("subscribes after SPA login when the host mounted on /login", () => {
    vi.mocked(wgwHasAuthenticatedSession).mockReturnValue(false);
    const { rerender } = render(<NotificationsHost />);
    expect(ensurePushPermissionAndSubscribe).not.toHaveBeenCalled();

    vi.mocked(wgwHasAuthenticatedSession).mockReturnValue(true);
    rerender(<NotificationsHost />);
    expect(ensurePushPermissionAndSubscribe).toHaveBeenCalled();
  });

  it("local-acks unread items on a visible Meet route so VAPID skips while JS is alive", async () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    vi.mocked(listNotifications).mockResolvedValue({ list: [unreadItem], unreadCount: 1 });

    render(<NotificationsHost />);

    await waitFor(() => {
      expect(ackLocalNotification).toHaveBeenCalledWith("n1");
    });
  });

  it("opening an item removes it from the unread tray list", async () => {
    vi.mocked(listNotifications).mockResolvedValue({ list: [unreadItem], unreadCount: 1 });

    let inbox: ReturnType<typeof useNotificationsInbox> = null;
    function Probe() {
      inbox = useNotificationsInbox();
      return null;
    }

    render(
      <NotificationsProvider>
        <Probe />
      </NotificationsProvider>,
    );

    await waitFor(() => {
      expect(inbox?.items).toHaveLength(1);
    });

    await inbox!.onOpenItem(unreadItem);
    await waitFor(() => {
      expect(inbox?.items).toHaveLength(0);
      expect(inbox?.unreadCount).toBe(0);
    });
    expect(ackNotification).toHaveBeenCalledWith("n1");
  });

  it("mark-all-read clears the unread tray list", async () => {
    vi.mocked(listNotifications).mockResolvedValue({ list: [unreadItem], unreadCount: 1 });

    let inbox: ReturnType<typeof useNotificationsInbox> = null;
    function Probe() {
      inbox = useNotificationsInbox();
      return null;
    }

    render(
      <NotificationsProvider>
        <Probe />
      </NotificationsProvider>,
    );

    await waitFor(() => {
      expect(inbox?.items).toHaveLength(1);
    });

    await inbox!.onMarkAllRead();
    await waitFor(() => {
      expect(inbox?.items).toHaveLength(0);
      expect(inbox?.unreadCount).toBe(0);
    });
    expect(ackNotification).toHaveBeenCalledWith("n1");
  });

  it("markReadWhere acks only matching navigate rows", async () => {
    const other = {
      ...unreadItem,
      id: "n2",
      navigate: "/meet/channels/general",
      tag: "chat.message:2",
    };
    vi.mocked(listNotifications).mockResolvedValue({
      list: [unreadItem, other],
      unreadCount: 2,
    });

    let inbox: ReturnType<typeof useNotificationsInbox> = null;
    function Probe() {
      inbox = useNotificationsInbox();
      return null;
    }

    render(
      <NotificationsProvider>
        <Probe />
      </NotificationsProvider>,
    );

    await waitFor(() => {
      expect(inbox?.items).toHaveLength(2);
    });

    await inbox!.markReadWhere((item) => item.navigate === "/meet/dms/alice");
    await waitFor(() => {
      expect(inbox?.items).toEqual([other]);
      expect(inbox?.unreadCount).toBe(1);
    });
    expect(ackNotification).toHaveBeenCalledWith("n1");
    expect(ackNotification).not.toHaveBeenCalledWith("n2");
  });

  it("Notification API click opens the inbox deep link", async () => {
    class FakeNotification {
      static permission = "granted" as NotificationPermission;
      static last: FakeNotification | null = null;
      onclick: (() => void) | null = null;
      constructor(
        readonly title: string,
        readonly options?: NotificationOptions,
      ) {
        FakeNotification.last = this;
      }
    }
    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      value: FakeNotification,
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    vi.mocked(listNotifications).mockResolvedValue({ list: [unreadItem], unreadCount: 1 });

    render(<NotificationsHost />);

    await waitFor(() => {
      expect(FakeNotification.last).not.toBeNull();
    });
    expect(FakeNotification.last?.title).toBe("Andrea sent you a direct message");
    expect(FakeNotification.last?.options?.body).toBe("hi");
    expect(FakeNotification.last?.options?.data).toEqual({ navigate: "/meet/dms/alice" });
    FakeNotification.last?.onclick?.();
    expect(assignNotificationNavigate).toHaveBeenCalledWith(
      "/meet/dms/alice",
      true,
      expect.any(Function),
    );
  });

  it("SW notificationclick postMessage opens the deep link after session expiry", () => {
    const listeners: Array<(event: MessageEvent) => void> = [];
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        addEventListener: (_type: string, listener: (event: MessageEvent) => void) => {
          listeners.push(listener);
        },
        removeEventListener: vi.fn(),
      },
    });
    vi.mocked(wgwHasAuthenticatedSession).mockReturnValue(false);

    render(<NotificationsHost />);
    expect(listeners).toHaveLength(1);
    listeners[0]?.({
      data: { type: WGW_NOTIFICATION_NAVIGATE_MESSAGE, navigate: "/meet/dms/alice" },
    } as MessageEvent);

    expect(assignNotificationNavigate).toHaveBeenCalledWith(
      "/meet/dms/alice",
      false,
      expect.any(Function),
    );
  });
});
