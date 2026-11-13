import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
import { toast } from "sonner";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { showNotificationToast } from "@/notifications-core/src/use-notification-toasts";
import type { NotificationInboxItem } from "@/lib/models/notifications-types";
import { AppToaster } from "@/ui/sonner";

const now = () => new Date().toISOString();

const DIRECT_MESSAGE: NotificationInboxItem = {
  id: "toast-dm",
  domain: "chat",
  action: "message_posted",
  title: "New chat message",
  body: null,
  data: { actor: "Marcel", isDm: true, snippet: "Can you join the STAK call at 15:00?" },
  navigate: "/meet/dms/marcel",
  tag: "chat.message:toast-dm",
  readAt: null,
  createdAt: now(),
};

const MEETING_STARTED: NotificationInboxItem = {
  id: "toast-meet",
  domain: "meet",
  action: "started",
  title: "Meeting started",
  body: null,
  data: { actor: "Nathalie", room: "Weekly planning" },
  navigate: "/meet/meetings/weekly-planning",
  tag: "meet.started:weekly-planning",
  readAt: null,
  createdAt: now(),
};

const DOC_COMMENT: NotificationInboxItem = {
  id: "toast-doc",
  domain: "docs",
  action: "thread_activity",
  title: "New comment",
  body: null,
  data: {
    actor: "Matthijs",
    fileName: "Agenda Anne & Co.md",
    isReply: false,
    snippet: "Shall we move the second point to next week? The budget is not final yet.",
  },
  navigate: "/docs?file=Agenda%20Anne%20%26%20Co.md",
  tag: "docs.thread:toast-doc",
  readAt: null,
  createdAt: now(),
};

type ToastDemoProps = {
  items: NotificationInboxItem[];
  onOpen: (item: NotificationInboxItem) => void;
};

/** Lets the toaster mount and subscribe first, as the app shell's does long before news arrives. */
const SHOW_AFTER_MS = 100;

/** Shows `items` as the toasts the elected tab would show; they stay until clicked. */
function NotificationToastDemo({ items, onOpen }: ToastDemoProps) {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      for (const item of items) showNotificationToast(item, onOpen, Number.POSITIVE_INFINITY);
    }, SHOW_AFTER_MS);
    return () => {
      window.clearTimeout(timer);
      toast.dismiss();
    };
  }, [items, onOpen]);
  return <AppToaster />;
}

const meta = {
  title: "Features/Workspace/Components/NotificationToast",
  component: NotificationToastDemo,
  tags: ["vitest-ci"],
  args: { onOpen: fn() },
} satisfies Meta<typeof NotificationToastDemo>;

export default meta;
type Story = StoryObj<typeof NotificationToastDemo>;

export const DirectMessage: Story = {
  args: { items: [DIRECT_MESSAGE] },
  play: async ({ args, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const status = await body.findByRole("status");
    await expect(status).toHaveTextContent("Marcel sent you a direct message");
    await expect(status).toHaveTextContent("Can you join the STAK call at 15:00?");
    await expect(status).toHaveTextContent("Meet");
    // Never takes focus: the page keeps its focus when the toast appears.
    await expect(status.contains(canvasElement.ownerDocument.activeElement)).toBe(false);

    // Keyboard: the toast is one button that opens the row.
    const open = within(status).getByRole("button", { name: /Marcel sent you a direct message/ });
    open.focus();
    await userEvent.keyboard("{Enter}");
    await expect(args.onOpen).toHaveBeenCalledWith(DIRECT_MESSAGE);
    await waitFor(() => expect(body.queryByRole("status")).not.toBeInTheDocument());
  },
};

export const MeetingStarted: Story = {
  args: { items: [MEETING_STARTED] },
  play: async ({ canvasElement }) => {
    const status = await within(canvasElement.ownerDocument.body).findByRole("status");
    await expect(status).toHaveTextContent("Nathalie started a meeting");
    await expect(status).toHaveTextContent("Weekly planning");
  },
};

export const DocComment: Story = {
  args: { items: [DOC_COMMENT] },
};

/** Several rows at once: Sonner stacks them, newest on top. */
export const Stacked: Story = {
  args: { items: [DOC_COMMENT, MEETING_STARTED, DIRECT_MESSAGE] },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await waitFor(() => expect(body.getAllByRole("status")).toHaveLength(3));
  },
};
