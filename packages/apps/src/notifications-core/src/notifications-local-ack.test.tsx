/** @vitest-environment jsdom */
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
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

import { ackLocalNotification, listNotifications } from "@/lib/api/wgw/notifications";
import { MeetCallProvider } from "@/meet-core/src/meet-call-provider";
import { createMeetCallStore, type MeetCallStore } from "@/meet-core/src/meet-call-store";
import {
  NOTIFICATIONS_INBOX_POLL_MS,
  NotificationsProvider,
  useNotificationsInbox,
} from "@/notifications-core/src/notifications-provider";

const unreadItem = {
  id: "n1",
  domain: "chat",
  action: "message_posted",
  title: "Andrea sent you a direct message",
  body: "hi",
  navigate: "/meet/dms/alice",
  tag: "chat.message:1",
  readAt: null,
  createdAt: "2026-10-27T12:00:00Z",
};

const laterItem = { ...unreadItem, id: "n2", tag: "chat.message:2" };

class FakeNotification {
  static permission = "granted" as NotificationPermission;
  static created: FakeNotification[] = [];
  onclick: (() => void) | null = null;
  constructor(
    readonly title: string,
    readonly options?: NotificationOptions,
  ) {
    FakeNotification.created.push(this);
  }
}

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: state,
  });
}

function becomeVisible(): void {
  setVisibility("visible");
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

const probe = { inbox: null as ReturnType<typeof useNotificationsInbox> };

function Probe() {
  probe.inbox = useNotificationsInbox();
  return null;
}

function renderInbox(callStore?: MeetCallStore) {
  const tree: ReactNode = (
    <NotificationsProvider>
      <Probe />
    </NotificationsProvider>
  );
  return render(callStore ? <MeetCallProvider store={callStore}>{tree}</MeetCallProvider> : tree);
}

/** Waits until the provider has processed the unread list (ack decisions run in the same step). */
async function waitForUnreadList(): Promise<void> {
  await waitFor(() => {
    expect(probe.inbox?.items).toHaveLength(1);
  });
}

describe("local-ack from a live window", () => {
  beforeEach(() => {
    probe.inbox = null;
    FakeNotification.created = [];
    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      value: FakeNotification,
    });
    vi.mocked(listNotifications).mockReset();
    vi.mocked(ackLocalNotification).mockReset();
    vi.mocked(listNotifications).mockResolvedValue({ list: [unreadItem], unreadCount: 1 });
    vi.mocked(ackLocalNotification).mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    setVisibility("visible");
  });

  it("acks unread items from a visible window", async () => {
    setVisibility("visible");
    renderInbox();

    await waitFor(() => {
      expect(ackLocalNotification).toHaveBeenCalledWith("n1");
    });
  });

  it("does not ack from a hidden window, so the service-worker push still reaches every device", async () => {
    setVisibility("hidden");
    renderInbox();

    await waitForUnreadList();
    expect(ackLocalNotification).not.toHaveBeenCalled();
  });

  it("creates no page-level OS notification from a hidden window", async () => {
    setVisibility("hidden");
    renderInbox();

    await waitForUnreadList();
    expect(FakeNotification.created).toHaveLength(0);
  });

  it("acks the unread items it saw while hidden once the window becomes visible", async () => {
    setVisibility("hidden");
    renderInbox();
    await waitForUnreadList();
    expect(ackLocalNotification).not.toHaveBeenCalled();

    becomeVisible();
    await waitFor(() => {
      expect(ackLocalNotification).toHaveBeenCalledWith("n1");
    });

    // A second visibility flip does not ack the same row again.
    setVisibility("hidden");
    becomeVisible();
    expect(ackLocalNotification).toHaveBeenCalledTimes(1);
  });

  it("re-fetches the inbox when the window becomes visible and acks rows that arrived meanwhile", async () => {
    setVisibility("hidden");
    renderInbox();
    await waitForUnreadList();
    const listedWhileHidden = vi.mocked(listNotifications).mock.calls.length;

    // A row arrived after the last (throttled) hidden poll.
    vi.mocked(listNotifications).mockResolvedValue({
      list: [unreadItem, laterItem],
      unreadCount: 2,
    });
    becomeVisible();

    await waitFor(() => {
      expect(ackLocalNotification).toHaveBeenCalledWith("n2");
    });
    expect(ackLocalNotification).toHaveBeenCalledWith("n1");
    expect(vi.mocked(listNotifications).mock.calls.length).toBeGreaterThan(listedWhileHidden);
  });

  it("does not re-fetch on visibility changes while the window stays hidden", async () => {
    setVisibility("hidden");
    renderInbox();
    await waitForUnreadList();
    const listedWhileHidden = vi.mocked(listNotifications).mock.calls.length;

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(listNotifications).toHaveBeenCalledTimes(listedWhileHidden);
  });

  it("acks from a hidden window while the user is in a Meet call", async () => {
    const callStore = createMeetCallStore();
    callStore.setStatus("in-call");
    setVisibility("hidden");
    renderInbox(callStore);

    await waitFor(() => {
      expect(ackLocalNotification).toHaveBeenCalledWith("n1");
    });
    expect(FakeNotification.created).toHaveLength(0);
  });

  it("acks what a hidden window saw once it joins a Meet call", async () => {
    const callStore = createMeetCallStore();
    setVisibility("hidden");
    renderInbox(callStore);
    await waitForUnreadList();
    expect(ackLocalNotification).not.toHaveBeenCalled();

    act(() => {
      callStore.setStatus("in-call");
    });
    await waitFor(() => {
      expect(ackLocalNotification).toHaveBeenCalledWith("n1");
    });
  });

  it("stops acking new rows once the Meet call ends while the window is hidden", async () => {
    vi.useFakeTimers();
    const callStore = createMeetCallStore();
    callStore.setStatus("in-call");
    setVisibility("hidden");
    renderInbox(callStore);
    await vi.advanceTimersByTimeAsync(0);
    expect(ackLocalNotification).toHaveBeenCalledWith("n1");

    act(() => {
      callStore.setStatus("idle");
    });
    vi.mocked(listNotifications).mockResolvedValue({
      list: [unreadItem, laterItem],
      unreadCount: 2,
    });
    await vi.advanceTimersByTimeAsync(NOTIFICATIONS_INBOX_POLL_MS);

    expect(probe.inbox?.items).toHaveLength(2);
    expect(ackLocalNotification).not.toHaveBeenCalledWith("n2");
    expect(ackLocalNotification).toHaveBeenCalledTimes(1);
  });

  it("does not count the Meet lobby as being in a call", async () => {
    const callStore = createMeetCallStore();
    callStore.setStatus("waiting");
    setVisibility("hidden");
    renderInbox(callStore);

    await waitForUnreadList();
    expect(ackLocalNotification).not.toHaveBeenCalled();
  });

  it("retries a failed ack the next time the window is visible", async () => {
    vi.mocked(ackLocalNotification).mockRejectedValueOnce(new Error("offline"));
    setVisibility("visible");
    renderInbox();
    await waitFor(() => {
      expect(ackLocalNotification).toHaveBeenCalledTimes(1);
    });

    setVisibility("hidden");
    becomeVisible();
    await waitFor(() => {
      expect(ackLocalNotification).toHaveBeenCalledTimes(2);
    });
  });
});
