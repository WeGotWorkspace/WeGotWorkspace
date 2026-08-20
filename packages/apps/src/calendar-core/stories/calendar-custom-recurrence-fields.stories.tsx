import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { CalendarCustomRecurrenceFields } from "@/calendar-core/src/calendar-custom-recurrence-fields";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";

const meta: Meta<typeof CalendarCustomRecurrenceFields> = {
  title: "Apps/Calendar/CustomRecurrenceFields",
  component: CalendarCustomRecurrenceFields,
  args: {
    rule: {
      "@type": "RecurrenceRule",
      frequency: "weekly",
      interval: 2,
      byDay: [
        { "@type": "NDay", day: "mo" },
        { "@type": "NDay", day: "we" },
      ],
    },
    startDateISO: "2033-01-12",
    labels: defaultCalendarLabels,
    locale: "en-US",
    onChange: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof CalendarCustomRecurrenceFields>;

export const Default: Story = {
  tags: ["vitest-ci"],
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("combobox", { name: defaultCalendarLabels.eventRecurrenceFrequencyLabel }),
    ).toBeTruthy();
    await userEvent.click(canvas.getByRole("button", { name: "Fri" }));
    await expect(args.onChange).toHaveBeenCalled();
  },
};
