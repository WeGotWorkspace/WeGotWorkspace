import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";
import { CalendarEventPane } from "@/calendar-core/src/calendar-event-pane";
import { emptyCalendarEventForm } from "@/calendar-core/src/calendar-editor-model";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import { createCalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";

const bootstrap = createCalendarAppBootstrap();

const lunchForm = {
  ...emptyCalendarEventForm("default", "2033-01-12"),
  title: "Lunch",
  location: "Cafe",
  startTime: "12:00",
  endTime: "13:00",
};

/** List mode's detail: the event form on the detail sheet, saved as you type. */
const meta: Meta<typeof CalendarEventPane> = {
  title: "Features/Calendar/EventPane",
  component: CalendarEventPane,
  args: {
    preview: { eventId: "lunch", form: lunchForm },
    calendars: bootstrap.data.calendars,
    labels: defaultCalendarLabels,
    locale: "en-US",
  },
};

export default meta;
type Story = StoryObj<typeof CalendarEventPane>;

/** An event in a calendar shared with you to read only: its fields are read-only. */
export const ReadOnly: Story = {
  tags: ["vitest-ci"],
  args: { preview: { eventId: "lunch", form: { ...lunchForm, calendarId: "family" } } },
  play: async ({ canvasElement }) => {
    const pane = canvasElement.querySelector(".calendar-event-pane");
    await expect(pane).toBeTruthy();
    await expect(within(canvasElement).getByDisplayValue("Lunch")).toHaveAttribute("readonly");
  },
};

export const Editing: Story = {
  tags: ["vitest-ci"],
  args: {
    edit: { form: lunchForm, onChange: fn(), onClose: fn(), onSave: fn() },
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByDisplayValue("Lunch")).not.toHaveAttribute("readonly");
  },
};

/** A change not yet on the server: the dot by the title. */
export const PendingSync: Story = {
  tags: ["vitest-ci"],
  args: { pendingSync: true },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole("img", { name: defaultCalendarLabels.pendingSync }),
    ).toBeTruthy();
  },
};
