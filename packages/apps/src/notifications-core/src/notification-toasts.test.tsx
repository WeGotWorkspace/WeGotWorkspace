/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FrontTab } from "@/lib/jmap-client/push/front-tab";

/** The push hub's election, as this tab sees it. */
const hub = vi.hoisted(() => ({
  front: null as FrontTab | null,
  value: {
    connected: false,
    leading: true,
    subscribe: () => () => undefined,
    subscribeStatus: () => () => undefined,
    frontTab: async (): Promise<FrontTab | null> => hub.front,
  },
}));

vi.mock("@/lib/api/wgw/http", () => ({
  wgwHasAuthenticatedSession: () => true,
  wgwIsGuestSession: () => false,
}));
vi.mock("@/lib/api/wgw/notifications", () => ({
  listNotifications: vi.fn(),
  ackNotification: vi.fn(),
  ackLocalNotifications: vi.fn(),
}));
vi.mock("@/lib/api/wgw/jmap-push", () => ({ defaultJmapPushHub: () => hub.value }));
vi.mock("@/notifications-core/src/ensure-push-subscription", () => ({
  ensurePushPermissionAndSubscribe: async () => false,
}));
vi.mock("@/notifications-core/src/notification-click-navigate", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/notifications-core/src/notification-click-navigate")
  >()),
  assignNotificationNavigate: vi.fn(),
}));

import { ackNotification, listNotifications } from "@/lib/api/wgw/notifications";
import { assignNotificationNavigate } from "@/notifications-core/src/notification-click-navigate";
import { NOTIFICATION_INBOX_SOUND_MUTED_KEY } from "@/notifications-core/src/notification-inbox-sound";
import {
  NotificationsProvider,
  useNotificationsInbox,
} from "@/notifications-core/src/notifications-provider";
import type { NotificationInboxItem } from "@/notifications-core/src/notifications-types";
import { AppToaster } from "@/ui/sonner";

const dm: NotificationInboxItem = {
  id: "n1",
  domain: "chat",
  action: "message_posted",
  title: "New message",
  body: null,
  data: { actor: "Admin", isDm: true, snippet: "Lunch at one?" },
  navigate: "/meet/dms/admin",
  tag: "chat.message:1",
  readAt: null,
  createdAt: "2026-11-04T10:00:00Z",
};

function front(self: boolean, route: string): FrontTab {
  return { tabId: self ? "here" : "other", self, focusedAt: 1, route };
}

let inboxIds: string[] = [];
function InboxIds() {
  inboxIds = useNotificationsInbox()?.items.map((item) => item.id) ?? [];
  return null;
}

/** Load the app with an empty inbox, then let `rows` arrive. */
async function arrive(rows: NotificationInboxItem[]) {
  vi.mocked(listNotifications).mockResolvedValue({ list: [], unreadCount: 0 });
  render(
    <NotificationsProvider>
      <InboxIds />
      <AppToaster />
    </NotificationsProvider>,
  );
  await waitFor(() => expect(listNotifications).toHaveBeenCalled());
  vi.mocked(listNotifications).mockResolvedValue({ list: rows, unreadCount: rows.length });
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await waitFor(() => expect(inboxIds).toEqual(rows.map((row) => row.id)));
  // Let the election and Sonner render.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

const toast = () => screen.queryByRole("status");

describe("in-app toasts", () => {
  beforeEach(() => {
    localStorage.clear();
    // No chime in jsdom.
    localStorage.setItem(NOTIFICATION_INBOX_SOUND_MUTED_KEY, "1");
    vi.mocked(listNotifications).mockReset();
    vi.mocked(ackNotification).mockReset().mockResolvedValue(undefined);
    vi.mocked(assignNotificationNavigate).mockReset();
    hub.front = front(true, "/drive");
  });

  afterEach(() => {
    cleanup();
  });

  it("shows a new row as a toast in the front tab: app, actor and title", async () => {
    await arrive([dm]);
    const status = toast();
    expect(status).not.toBeNull();
    expect(status!.textContent).toContain("Admin");
    expect(status!.textContent).toContain("sent you a direct message");
    expect(status!.textContent).toContain("Lunch at one?");
    expect(status!.textContent).toContain("Meet");
    // A status region that never takes focus.
    expect(status!.contains(document.activeElement)).toBe(false);
  });

  it("opens the row and marks it read on click", async () => {
    await arrive([dm]);
    fireEvent.click(screen.getByRole("button", { name: /Admin/ }));
    await waitFor(() => expect(ackNotification).toHaveBeenCalledWith("n1"));
    await waitFor(() =>
      expect(assignNotificationNavigate).toHaveBeenCalledWith(
        "/meet/dms/admin",
        true,
        expect.any(Function),
      ),
    );
    expect(inboxIds).toEqual([]);
  });

  it("shows nothing in a tab that is not in front", async () => {
    hub.front = front(false, "/drive");
    await arrive([dm]);
    expect(toast()).toBeNull();
  });

  it("shows nothing when every tab is hidden", async () => {
    hub.front = null;
    await arrive([dm]);
    expect(toast()).toBeNull();
  });

  it("does not toast what the front tab already shows; the row stays in the popover", async () => {
    hub.front = front(true, "/meet/dms/admin");
    await arrive([dm]);
    expect(toast()).toBeNull();
    expect(inboxIds).toEqual(["n1"]);
  });

  it("does not toast rows that were there when the app loaded", async () => {
    vi.mocked(listNotifications).mockResolvedValue({ list: [dm], unreadCount: 1 });
    render(
      <NotificationsProvider>
        <InboxIds />
        <AppToaster />
      </NotificationsProvider>,
    );
    await waitFor(() => expect(inboxIds).toEqual(["n1"]));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(toast()).toBeNull();
  });
});
