import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { NotificationInboxTray } from "@/notifications-core/src/notification-inbox-tray";
import type { NotificationInboxItem } from "@/notifications-core/src/notifications-types";

const ITEMS: NotificationInboxItem[] = [
  {
    id: "1",
    title: "Standup",
    body: "Starts in 15 minutes",
    navigate: "/calendar",
    tag: "calendar.alert_due:1",
    readAt: null,
    createdAt: "2026-09-12T12:00:00Z",
  },
  {
    id: "2",
    title: "notes.md was shared with you",
    body: "bob shared a document with you.",
    navigate: "/docs",
    tag: "docs.shared:2",
    readAt: "2026-09-12T12:01:00Z",
    createdAt: "2026-09-12T11:00:00Z",
  },
];

const meta = {
  title: "Apps/WeGotWorkspace/Components/NotificationInboxTray",
  component: NotificationInboxTray,
  tags: ["vitest-ci"],
} satisfies Meta<typeof NotificationInboxTray>;

export default meta;
type Story = StoryObj<typeof NotificationInboxTray>;

export const Unread: Story = {
  args: {
    items: ITEMS,
    unreadCount: 1,
    onOpenItem: () => undefined,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Notifications (1 unread)" }));
    const body = within(canvasElement.ownerDocument.body);
    await expect(body.getByText("Standup")).toBeInTheDocument();
    await expect(body.getByText("notes.md was shared with you")).toBeInTheDocument();
  },
};

export const Empty: Story = {
  args: {
    items: [],
    unreadCount: 0,
    onOpenItem: () => undefined,
  },
};
