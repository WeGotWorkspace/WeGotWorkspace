import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { CalendarCalendarDialog } from "@/calendar-core/src/calendar-calendar-dialog";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import { createCalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";

const bootstrap = createCalendarAppBootstrap();

const meta: Meta<typeof CalendarCalendarDialog> = {
  title: "Apps/Calendar/CalendarDialog",
  component: CalendarCalendarDialog,
  args: {
    labels: defaultCalendarLabels,
    groups: bootstrap.data.groups,
    personalOwnerLabel: "Me",
    onClose: fn(),
    onConfirm: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof CalendarCalendarDialog>;

export const Create: Story = {
  tags: ["vitest-ci"],
  args: {
    dialog: { mode: "create" },
  },
};

export const Subscribe: Story = {
  tags: ["vitest-ci"],
  args: {
    dialog: { mode: "subscribe" },
  },
};

export const EditOwned: Story = {
  args: {
    dialog: {
      mode: "edit",
      calendarId: "default",
      name: "Personal",
      color: "#6366f1",
      mayDelete: true,
      scope: "personal",
      canPublish: true,
    },
    publish: {
      feed: null,
      onToggle: fn(),
      onCopyHttps: fn(),
      onCopyWebcal: fn(),
    },
    onDelete: fn(),
  },
};

export const EditPublished: Story = {
  args: {
    dialog: {
      mode: "edit",
      calendarId: "default",
      name: "Personal",
      color: "#6366f1",
      mayDelete: true,
      scope: "personal",
      canPublish: true,
    },
    publish: {
      feed: {
        httpsUrl: "https://example.test/api/v1/calendars/feeds/persontoken",
        webcalUrl: "webcal://example.test/api/v1/calendars/feeds/persontoken",
      },
      onToggle: fn(),
      onCopyHttps: fn(),
      onCopyWebcal: fn(),
    },
    onDelete: fn(),
  },
};

export const EditSubscription: Story = {
  tags: ["vitest-ci"],
  args: {
    dialog: {
      mode: "edit",
      calendarId: "holidays",
      name: "US Holidays",
      color: "#8b5cf6",
      mayDelete: true,
      scope: "personal",
      subscriptionId: "sub-holidays",
      sourceUrl: "https://feeds.example.test/holidays.ics",
    },
    onDelete: fn(),
  },
};
