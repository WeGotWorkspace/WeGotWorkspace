import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { NotificationInboxTray } from "@/notifications-core/src/notification-inbox-tray";
import type { NotificationInboxItem } from "@/notifications-core/src/notifications-types";

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

/**
 * Unread-only fixtures (matches production tray: GET ?unread=1).
 * Raw `data` facts — tray formats via formatNotificationCopy.
 */
const UNREAD_ITEMS: NotificationInboxItem[] = [
  {
    id: "1",
    domain: "chat",
    action: "message_posted",
    title: "New chat message",
    body: null,
    data: {
      actor: "Marcel",
      channelKind: "channel",
      channelName: "administrators",
      snippet: "@wouter can you join the STAK call at 15:00?",
      isDm: false,
    },
    navigate: "/meet/channels/administrators",
    tag: "chat.message:1",
    readAt: null,
    createdAt: minutesAgo(4),
  },
  {
    id: "2",
    domain: "calendar",
    action: "invite",
    title: "Calendar invitation",
    body: null,
    data: {
      actor: "Nathalie",
      summary: "Zaterdag Open",
      start: "2026-09-19T09:00:00Z",
      end: "2026-09-19T12:00:00Z",
      location: "Dorpsstraat",
    },
    navigate: "/calendar",
    tag: "calendar.invite:zaterdag-open",
    readAt: null,
    createdAt: minutesAgo(12),
  },
  {
    id: "3",
    domain: "calendar",
    action: "alert_due",
    title: "Calendar reminder",
    body: null,
    data: {
      summary: "Zaterdag Open",
      start: "2026-09-19T09:00:00Z",
      end: "2026-09-19T12:00:00Z",
      location: "Dorpsstraat",
    },
    navigate: "/calendar",
    tag: "calendar.alert_due:3",
    readAt: null,
    createdAt: minutesAgo(22),
  },
  {
    id: "4",
    domain: "docs",
    action: "shared",
    title: "A document was shared with you",
    body: null,
    data: {
      actor: "Matthijs",
      path: "/users/matthijs/Agenda Anne & Co.md",
      fileName: "Agenda Anne & Co.md",
    },
    navigate: "/docs",
    tag: "docs.shared:4",
    readAt: null,
    createdAt: minutesAgo(60),
  },
  {
    id: "5",
    domain: "tasks",
    action: "alert_due",
    title: "Task reminder",
    body: null,
    data: {
      summary: "Invoice STAK Q3",
      start: "2026-09-19T17:00:00Z",
      end: "2026-09-19T17:00:00Z",
    },
    navigate: "/tasks",
    tag: "tasks.alert_due:5",
    readAt: null,
    createdAt: minutesAgo(90),
  },
];

const meta = {
  title: "Apps/WeGotWorkspace/Components/NotificationInboxTray",
  component: NotificationInboxTray,
  tags: ["vitest-ci"],
  args: {
    onOpenItem: fn(),
    onMarkAllRead: fn(),
    onToggleSoundMute: fn(),
    soundMuted: false,
  },
} satisfies Meta<typeof NotificationInboxTray>;

export default meta;
type Story = StoryObj<typeof NotificationInboxTray>;

export const Unread: Story = {
  args: {
    items: UNREAD_ITEMS,
    unreadCount: UNREAD_ITEMS.length,
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Notifications (5 unread)" }));
    const body = within(canvasElement.ownerDocument.body);
    await expect(body.getByRole("heading", { name: "Notifications" })).toBeInTheDocument();
    await expect(body.getByRole("button", { name: "Mute notification sound" })).toBeInTheDocument();
    await expect(body.getByRole("button", { name: "Mark all read" })).toBeInTheDocument();
    await expect(body.getAllByText("Meet").length).toBe(1);
    await expect(body.getAllByText("Calendar").length).toBeGreaterThanOrEqual(2);
    await expect(body.getByText("Docs")).toBeInTheDocument();
    await expect(body.getByText("Tasks")).toBeInTheDocument();
    await expect(
      body.getByText((_, el) =>
        Boolean(
          el?.classList.contains("notification-inbox-tray__row-title") &&
          (el.textContent ?? "")
            .replace(/\s+/g, " ")
            .includes("Marcel sent a message in #administrators"),
        ),
      ),
    ).toBeInTheDocument();
    const marcelActor = body.getByText((content, el) =>
      Boolean(
        el?.classList.contains("notification-inbox-tray__title-actor") && content === "Marcel",
      ),
    );
    await expect(marcelActor.tagName).toBe("STRONG");
    await expect(
      body.getByText((_, el) =>
        Boolean(
          el?.classList.contains("notification-inbox-tray__row-title") &&
          (el.textContent ?? "")
            .replace(/\s+/g, " ")
            .includes("Nathalie invited you to Zaterdag Open"),
        ),
      ),
    ).toBeInTheDocument();
    await expect(body.getByText("Zaterdag Open")).toBeInTheDocument();
    await expect(
      body.getAllByText("Sat 19 Sep · 09:00 – 12:00 · Dorpsstraat").length,
    ).toBeGreaterThanOrEqual(1);
    await expect(body.getAllByText("Sat 19 Sep · 09:00 – 12:00").length).toBeGreaterThanOrEqual(1);
    await expect(
      body.getByText((_, el) =>
        Boolean(
          el?.classList.contains("notification-inbox-tray__row-title") &&
          (el.textContent ?? "")
            .replace(/\s+/g, " ")
            .includes("Matthijs shared Agenda Anne & Co.md with you"),
        ),
      ),
    ).toBeInTheDocument();
    await expect(body.getByText("Invoice STAK Q3")).toBeInTheDocument();
    await expect(body.queryByText("Andrea sent you a direct message")).not.toBeInTheDocument();
    await userEvent.click(body.getByRole("button", { name: "Mute notification sound" }));
    await expect(args.onToggleSoundMute).toHaveBeenCalled();
    await userEvent.click(body.getByRole("button", { name: "Mark all read" }));
    await expect(args.onMarkAllRead).toHaveBeenCalled();
  },
};

export const Empty: Story = {
  args: {
    items: [],
    unreadCount: 0,
    onOpenItem: () => undefined,
    onMarkAllRead: () => undefined,
  },
};

export const SoundMuted: Story = {
  args: {
    items: UNREAD_ITEMS,
    unreadCount: UNREAD_ITEMS.length,
    soundMuted: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Notifications (5 unread)" }));
    const body = within(canvasElement.ownerDocument.body);
    await expect(
      body.getByRole("button", { name: "Unmute notification sound" }),
    ).toBeInTheDocument();
  },
};

export const EnableAlerts: Story = {
  args: {
    items: UNREAD_ITEMS,
    unreadCount: UNREAD_ITEMS.length,
    onEnablePush: () => undefined,
    pushEnabled: false,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Notifications (5 unread)" }));
    const body = within(canvasElement.ownerDocument.body);
    await expect(body.getByRole("button", { name: "Enable alerts" })).toBeInTheDocument();
    await expect(body.getByRole("button", { name: "Mute notification sound" })).toBeInTheDocument();
    await expect(body.getByRole("button", { name: "Mark all read" })).toBeInTheDocument();
  },
};
