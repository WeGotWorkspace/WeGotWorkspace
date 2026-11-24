/** @vitest-environment jsdom */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FrontTab } from "@/lib/jmap-client/push/front-tab";

const filter = vi.hoisted(() => ({ ids: null as string[] | null }));
vi.mock("@/lib/projects/use-project-filter", () => ({
  useSelectedProjectIds: () => filter.ids,
}));

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
  ackNotifications: vi.fn(),
  ackLocalNotifications: vi.fn(),
}));
vi.mock("@/lib/api/wgw/jmap-push", () => ({ defaultJmapPushHub: () => hub.value }));
vi.mock("@/notifications-core/src/ensure-push-subscription", () => ({
  ensurePushPermissionAndSubscribe: async () => false,
}));

import { listNotifications } from "@/lib/api/wgw/notifications";
import { NotificationInboxTray } from "@/notifications-core/src/notification-inbox-tray";
import { NOTIFICATION_INBOX_SOUND_MUTED_KEY } from "@/notifications-core/src/notification-inbox-sound";
import {
  NotificationsProvider,
  useNotificationsInbox,
} from "@/notifications-core/src/notifications-provider";
import type { NotificationInboxItem } from "@/lib/models/notifications-types";
import { AppToaster } from "@/ui/sonner";

function row(id: string, projectId: string | null, actor: string): NotificationInboxItem {
  return {
    id,
    domain: "chat",
    action: "message_posted",
    title: "New message",
    body: null,
    data: { actor, isDm: true, snippet: `from ${actor}` },
    navigate: "/meet/dms/admin",
    tag: null,
    projectId,
    readAt: null,
    createdAt: "2026-11-22T10:00:00Z",
  };
}

const inP1 = row("n1", "p1", "Ann");
const inP2 = row("n2", "p2", "Bo");
const personal = row("n3", null, "Cy");

describe("the Project filter and the inbox", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(NOTIFICATION_INBOX_SOUND_MUTED_KEY, "1");
    vi.mocked(listNotifications).mockReset();
    hub.front = { tabId: "here", self: true, focusedAt: 1, route: "/drive" };
    filter.ids = null;
  });
  afterEach(() => cleanup());

  it("counts and lists only the Project's rows on the bell, and says how many are hidden", () => {
    render(
      <NotificationInboxTray
        items={[inP1, inP2, personal]}
        unreadCount={3}
        projectIds={["p1"]}
        onOpenItem={() => undefined}
      />,
    );
    expect(screen.getByRole("button", { name: "Notifications (2 unread)" })).toBeTruthy();
    act(() => screen.getByRole("button", { name: /Notifications/ }).click());
    expect(screen.getByText("1 hidden by the Project filter")).toBeTruthy();
    expect(screen.getByText(/from Ann/)).toBeTruthy();
    expect(screen.getByText(/from Cy/)).toBeTruthy();
    expect(screen.queryByText(/from Bo/)).toBeNull();
  });

  it("shows every row and no hidden line for All Projects", () => {
    render(
      <NotificationInboxTray
        items={[inP1, inP2, personal]}
        unreadCount={3}
        projectIds={null}
        onOpenItem={() => undefined}
      />,
    );
    expect(screen.getByRole("button", { name: "Notifications (3 unread)" })).toBeTruthy();
    act(() => screen.getByRole("button", { name: /Notifications/ }).click());
    expect(screen.getByText(/from Bo/)).toBeTruthy();
    expect(screen.queryByText(/hidden by the Project filter/)).toBeNull();
  });

  let inboxIds: string[] = [];
  function InboxIds() {
    inboxIds = useNotificationsInbox()?.items.map((item) => item.id) ?? [];
    return null;
  }

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
    await waitFor(() => expect(inboxIds).toEqual(rows.map((item) => item.id)));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }

  it("does not toast a row of another Project, which stays in the inbox for the tray", async () => {
    filter.ids = ["p1"];
    await arrive([inP2]);
    expect(screen.queryByRole("status")).toBeNull();
    expect(inboxIds).toEqual(["n2"]);
  });

  it("toasts the row of the selected Project", async () => {
    filter.ids = ["p1"];
    await arrive([inP1]);
    expect(screen.getByRole("status").textContent).toContain("Ann");
  });
});
