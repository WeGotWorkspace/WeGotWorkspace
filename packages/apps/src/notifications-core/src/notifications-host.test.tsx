/** @vitest-environment jsdom */
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/wgw/http", () => ({
  wgwHasAuthenticatedSession: vi.fn(() => true),
  wgwIsGuestSession: vi.fn(() => false),
}));

vi.mock("@/lib/api/wgw/notifications", () => ({
  listNotifications: vi.fn(async () => ({ list: [], unreadCount: 0 })),
  ackNotifications: vi.fn(),
  ackLocalNotifications: vi.fn(),
  fetchVapidPublicKey: vi.fn(),
  subscribePush: vi.fn(),
}));

vi.mock("@/lib/api/wgw/jmap-push", () => ({ defaultJmapPushHub: () => null }));

vi.mock("@/notifications-core/src/ensure-push-subscription", () => ({
  ensurePushPermissionAndSubscribe: vi.fn(async () => false),
}));

vi.mock("@/lib/notifications/notification-click-navigate", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/notifications/notification-click-navigate")>();
  return {
    ...actual,
    assignNotificationNavigate: vi.fn(),
  };
});

import { wgwHasAuthenticatedSession, wgwIsGuestSession } from "@/lib/api/wgw/http";
import {
  ackLocalNotifications,
  ackNotifications,
  listNotifications,
} from "@/lib/api/wgw/notifications";
import { ensurePushPermissionAndSubscribe } from "@/notifications-core/src/ensure-push-subscription";
import {
  assignNotificationNavigate,
  WGW_NOTIFICATION_NAVIGATE_MESSAGE,
} from "@/lib/notifications/notification-click-navigate";
import { WGW_NOTIFICATION_PUSHED_MESSAGE } from "@/notifications-core/src/push-delivery";
import {
  NotificationsHost,
  NotificationsProvider,
  NOTIFICATIONS_INBOX_POLL_MS,
  useNotificationsInbox,
} from "@/notifications-core/src/notifications-provider";
import {
  NOTIFICATION_INBOX_SOUND_MUTED_KEY,
  resetInboxNotificationSoundForTests,
} from "@/notifications-core/src/notification-inbox-sound";
import { PresenceStoreValueProvider } from "@/presence-core/src/presence-provider";
import { createPresenceStore } from "@/presence-core/src/presence-store";
import type {
  PresenceEnvelope,
  PresenceMeshEvent,
  PresenceMeshSession,
} from "@/presence-core/src/presence-types";
import type { RtcPeerDescriptor } from "@/lib/rtc/types";

/** Every id sent to `POST /notifications/local-ack`, across batches. */
const ackedIds = () => vi.mocked(ackLocalNotifications).mock.calls.flatMap(([ids]) => [...ids]);

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
  isLinked(): boolean {
    return false;
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
    localStorage.clear();
    vi.mocked(ackLocalNotifications).mockReset();
    vi.mocked(ackNotifications).mockReset();
    vi.mocked(assignNotificationNavigate).mockReset();
    vi.mocked(listNotifications).mockResolvedValue({ list: [], unreadCount: 0 });
    vi.mocked(ackLocalNotifications).mockResolvedValue(undefined);
    vi.mocked(ackNotifications).mockResolvedValue(undefined);
    window.localStorage.removeItem(NOTIFICATION_INBOX_SOUND_MUTED_KEY);
    resetInboxNotificationSoundForTests();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    window.localStorage.removeItem(NOTIFICATION_INBOX_SOUND_MUTED_KEY);
    resetInboxNotificationSoundForTests();
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
    expect(listNotifications).toHaveBeenCalledWith(expect.objectContaining({ unread: true }));

    await vi.advanceTimersByTimeAsync(NOTIFICATIONS_INBOX_POLL_MS - 1);
    expect(listNotifications).toHaveBeenCalledTimes(baseline);

    await vi.advanceTimersByTimeAsync(1);
    expect(listNotifications).toHaveBeenCalledTimes(baseline + 1);
  });

  it("requests unread-only inbox rows for the bell tray", async () => {
    render(<NotificationsHost />);
    await waitFor(() => {
      expect(listNotifications).toHaveBeenCalledWith(expect.objectContaining({ unread: true }));
    });
  });

  it("refreshes the inbox immediately on an inbound check-now while push is down", async () => {
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
      envelope: { v: 1, kind: "check-now" },
    });

    // Immediate hint GET + scheduled retries at 300ms and 1200ms.
    expect(vi.mocked(listNotifications).mock.calls.length).toBeGreaterThan(baseline);
    await vi.advanceTimersByTimeAsync(1_200);
    expect(vi.mocked(listNotifications).mock.calls.length).toBeGreaterThanOrEqual(baseline + 3);
  });

  it("does not let a slow in-flight GET overwrite a newer check-now refresh", async () => {
    type InboxPayload = { list: (typeof unreadItem)[]; unreadCount: number };
    const slow = {
      resolve: null as null | ((value: InboxPayload) => void),
    };
    let call = 0;
    vi.mocked(listNotifications).mockImplementation((): Promise<InboxPayload> => {
      call += 1;
      if (call === 1) {
        // Mount refresh — hang until after the hint so we can prove abort/ignore.
        return new Promise<InboxPayload>((resolve) => {
          slow.resolve = resolve;
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

    const probe = { inbox: null as ReturnType<typeof useNotificationsInbox> };
    function Probe() {
      probe.inbox = useNotificationsInbox();
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
      expect(slow.resolve).not.toBeNull();
    });

    session.emit({
      type: "envelope",
      peerId: "bob-1",
      envelope: { v: 1, kind: "check-now" },
    });

    await waitFor(() => {
      expect(probe.inbox?.unreadCount).toBe(1);
      expect(probe.inbox?.items).toHaveLength(1);
    });

    // Slow mount GET resolves empty after abort — must not wipe the hint result.
    slow.resolve?.({ list: [], unreadCount: 0 });
    await Promise.resolve();
    expect(probe.inbox?.unreadCount).toBe(1);
    expect(probe.inbox?.items).toHaveLength(1);
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

  it("local-acks unread items on a visible Meet route so VAPID skips them", async () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    vi.mocked(listNotifications).mockResolvedValue({ list: [unreadItem], unreadCount: 1 });

    render(<NotificationsHost />);

    await waitFor(() => {
      expect(ackedIds()).toContain("n1");
    });
  });

  it("plays the inbox chime and bumps pulse nonce for post-seed arrivals; mute skips sound only", async () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    const play = vi.fn(async () => undefined);
    vi.stubGlobal(
      "Audio",
      vi.fn(function AudioMock(this: { currentTime: number; play: typeof play }) {
        this.currentTime = 0;
        this.play = play;
      }),
    );

    let phase: "seed" | "first-new" | "second-new" = "seed";
    vi.mocked(listNotifications).mockImplementation(async () => {
      if (phase === "seed") return { list: [], unreadCount: 0 };
      if (phase === "first-new") return { list: [unreadItem], unreadCount: 1 };
      return {
        list: [unreadItem, { ...unreadItem, id: "n2", tag: "chat.message:2" }],
        unreadCount: 2,
      };
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
      expect(inbox).not.toBeNull();
      expect(inbox?.unreadArrivalNonce).toBe(0);
    });
    expect(play).not.toHaveBeenCalled();

    phase = "first-new";
    session.emit({
      type: "envelope",
      peerId: "bob-1",
      envelope: { v: 1, kind: "check-now" },
    });

    await waitFor(() => {
      expect(inbox?.unreadArrivalNonce).toBe(1);
      expect(play).toHaveBeenCalledTimes(1);
    });

    inbox!.onToggleSoundMute();
    await waitFor(() => {
      expect(inbox?.soundMuted).toBe(true);
    });

    phase = "second-new";
    session.emit({
      type: "envelope",
      peerId: "bob-1",
      envelope: { v: 1, kind: "check-now" },
    });

    await waitFor(() => {
      expect(inbox?.unreadArrivalNonce).toBe(2);
    });
    expect(play).toHaveBeenCalledTimes(1);
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
    expect(ackNotifications).toHaveBeenCalledWith(["n1"]);
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
    expect(ackNotifications).toHaveBeenCalledWith(["n1"]);
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
    expect(ackNotifications).toHaveBeenCalledWith(["n1"]);
    expect(ackNotifications).toHaveBeenCalledTimes(1);
  });

  it("opening a channel with 32 unread mentions marks them read with one request (#2154)", async () => {
    const mentions = Array.from({ length: 32 }, (_, index) => ({
      ...unreadItem,
      id: `m${index + 1}`,
      tag: `chat.mentioned:${index + 1}`,
    }));
    vi.mocked(listNotifications).mockResolvedValue({ list: mentions, unreadCount: 32 });

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
      expect(inbox?.items).toHaveLength(32);
    });

    await inbox!.markReadWhere((item) => item.navigate === unreadItem.navigate);
    await waitFor(() => {
      expect(inbox?.unreadCount).toBe(0);
    });
    expect(ackNotifications).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ackNotifications).mock.calls[0]?.[0]).toHaveLength(32);
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
  it("shows a row the service worker posted at once, keeps it through a stale list, and chimes once (#1670)", async () => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    const play = vi.fn(async () => undefined);
    vi.stubGlobal(
      "Audio",
      vi.fn(function AudioMock(this: { currentTime: number; play: typeof play }) {
        this.currentTime = 0;
        this.play = play;
      }),
    );
    const listeners: Array<(event: MessageEvent) => void> = [];
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        addEventListener: (_type: string, listener: (event: MessageEvent) => void) => {
          listeners.push(listener);
        },
        removeEventListener: (_type: string, listener: (event: MessageEvent) => void) => {
          const at = listeners.indexOf(listener);
          if (at >= 0) listeners.splice(at, 1);
        },
      },
    });
    const meeting = {
      ...unreadItem,
      id: "meet-1",
      domain: "meet",
      action: "started",
      title: "Alice started a meeting",
      navigate: "/meet/meetings/standup",
    };
    const probe: { inbox: ReturnType<typeof useNotificationsInbox> } = { inbox: null };
    function Probe() {
      probe.inbox = useNotificationsInbox();
      return null;
    }
    render(
      <NotificationsProvider>
        <Probe />
      </NotificationsProvider>,
    );
    await waitFor(() => expect(probe.inbox?.items).toEqual([]));
    await waitFor(() => expect(listeners.length).toBeGreaterThan(0));

    listeners.at(-1)?.({
      data: { type: WGW_NOTIFICATION_PUSHED_MESSAGE, item: meeting },
    } as MessageEvent);

    await waitFor(() => {
      expect(probe.inbox?.items.map((item) => item.id)).toEqual(["meet-1"]);
      expect(probe.inbox?.unreadCount).toBe(1);
    });
    expect(play).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(ackedIds()).toContain("meet-1"));

    // A list fetched before the push still lacks the row: the row stays.
    vi.mocked(listNotifications).mockResolvedValue({ list: [], unreadCount: 0 });
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(vi.mocked(listNotifications).mock.calls.length).toBeGreaterThan(1));
    expect(probe.inbox?.items.map((item) => item.id)).toEqual(["meet-1"]);

    // The list that carries it confirms it without a second chime.
    vi.mocked(listNotifications).mockResolvedValue({
      list: [{ ...meeting, data: { actor: "Alice" } }],
      unreadCount: 1,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(probe.inbox?.items[0]?.data).toEqual({ actor: "Alice" }));
    expect(probe.inbox?.unreadCount).toBe(1);
    expect(play).toHaveBeenCalledTimes(1);

    // Posted again (a late second push): ignored.
    listeners.at(-1)?.({
      data: { type: WGW_NOTIFICATION_PUSHED_MESSAGE, item: meeting },
    } as MessageEvent);
    expect(probe.inbox?.items).toHaveLength(1);
    expect(play).toHaveBeenCalledTimes(1);
  });
});
