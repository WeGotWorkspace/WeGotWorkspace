import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { CalendarPublishSection } from "@/calendar-core/src/calendar-publish-section";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";

const meta: Meta<typeof CalendarPublishSection> = {
  title: "Apps/Calendar/PublishSection",
  component: CalendarPublishSection,
  args: {
    labels: defaultCalendarLabels,
    onToggle: fn(),
    onCopyHttps: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof CalendarPublishSection>;

export const Unpublished: Story = {
  tags: ["vitest-ci"],
  args: {
    feed: null,
  },
};

export const Published: Story = {
  tags: ["vitest-ci"],
  args: {
    feed: {
      httpsUrl: "https://example.test/api/v1/calendars/feeds/persontoken",
      webcalUrl: "webcal://example.test/api/v1/calendars/feeds/persontoken",
    },
  },
};
