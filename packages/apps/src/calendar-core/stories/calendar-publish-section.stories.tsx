import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { CalendarPublishSection } from "@/calendar-core/src/calendar-publish-section";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import "@/calendar-core/src/calendar-workspace.css";

const publishedFeed = {
  httpsUrl: "https://example.test/api/v1/calendars/feeds/persontoken",
  webcalUrl: "webcal://example.test/api/v1/calendars/feeds/persontoken",
};

const meta: Meta<typeof CalendarPublishSection> = {
  title: "Apps/Calendar/PublishSection",
  component: CalendarPublishSection,
  args: {
    labels: defaultCalendarLabels,
    onToggle: fn(),
    onCopyHttps: fn(),
  },
  render: (args) => (
    <div className="calendar-workspace calendar-dialog-surface max-w-xl p-6">
      <CalendarPublishSection {...args} />
    </div>
  ),
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
    feed: publishedFeed,
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const httpsField = canvas.getByRole("textbox", {
      name: defaultCalendarLabels.publishCalendarHttpsLabel,
    });
    await expect(httpsField).toHaveValue(publishedFeed.httpsUrl);
    await expect(httpsField).toHaveClass("share-dialog__input");
    await expect(httpsField.closest(".share-dialog__link-row")).not.toBeNull();
    await expect(canvas.getAllByRole("textbox")).toHaveLength(1);

    const openLink = canvas.getByRole("link", { name: defaultCalendarLabels.openInCalendar });
    await expect(openLink).toHaveAttribute("href", publishedFeed.webcalUrl);
    await expect(openLink).toHaveClass("share-dialog__icon-link");

    await userEvent.click(canvas.getByRole("button", { name: defaultCalendarLabels.copyHttpsUrl }));
    await expect(args.onCopyHttps).toHaveBeenCalledOnce();
  },
};
