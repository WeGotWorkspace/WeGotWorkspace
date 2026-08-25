import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent } from "storybook/test";
import { CalendarImportDialog } from "@/calendar-core/src/calendar-import-dialog";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import { createCalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";
import "@/calendar-core/src/calendar-workspace.css";

const bootstrap = createCalendarAppBootstrap();
const sampleFile = new File(["BEGIN:VCALENDAR"], "team-offsite.ics", { type: "text/calendar" });

const meta: Meta<typeof CalendarImportDialog> = {
  title: "Apps/Calendar/ImportDialog",
  component: CalendarImportDialog,
  args: {
    open: true,
    file: sampleFile,
    labels: defaultCalendarLabels,
    calendars: bootstrap.data.calendars,
    preferredCalendarId: bootstrap.data.calendars[0]?.id,
    onClose: fn(),
    onImport: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof CalendarImportDialog>;

function destinationTrigger(destinationName: string) {
  return screen.getByRole("button", {
    name: `${defaultCalendarLabels.importDestinationLegend}: ${destinationName}`,
  });
}

export const ExistingDestination: Story = {
  tags: ["vitest-ci"],
  play: async () => {
    await expect(screen.queryByLabelText(/ICS file/i)).toBeNull();
    await expect(document.querySelector("input[type=file]")).toBeNull();
    const trigger = destinationTrigger("Personal");
    await expect(trigger.querySelector(".calendar-color-swatch-trigger__dot")).toBeTruthy();
    await expect(screen.queryByLabelText(defaultCalendarLabels.calendarNameLabel)).toBeNull();
    await expect(
      screen.getByRole("button", { name: defaultCalendarLabels.importSubmit }),
    ).not.toBeDisabled();

    await userEvent.click(trigger);
    const personal = screen.getByRole("menuitem", { name: "Personal" });
    await expect(personal.querySelector(".calendar-sidebar-dot")).toBeTruthy();
    const newCalendar = screen.getByRole("menuitem", { name: defaultCalendarLabels.newCalendar });
    await expect(newCalendar.querySelector(".calendar-sidebar-dot")).toBeNull();
    const menu = newCalendar.closest("[role='menu']");
    await expect(menu?.querySelector("[role='separator']")).toBeTruthy();
    await expect(menu?.querySelector("[role='separator'] + [role='menuitem']")?.textContent).toBe(
      defaultCalendarLabels.newCalendar,
    );

    await userEvent.click(newCalendar);
    await expect(screen.getByLabelText(defaultCalendarLabels.calendarNameLabel)).toHaveValue(
      "team-offsite",
    );
    await expect(
      destinationTrigger(defaultCalendarLabels.newCalendar).querySelector(
        ".calendar-color-swatch-trigger__dot",
      ),
    ).toBeNull();
  },
};

export const NewCalendar: Story = {
  tags: ["vitest-ci"],
  args: {
    calendars: bootstrap.data.calendars.map((calendar) => ({ ...calendar, mayWrite: false })),
  },
  play: async () => {
    await expect(
      destinationTrigger(defaultCalendarLabels.newCalendar).querySelector(
        ".calendar-color-swatch-trigger__dot",
      ),
    ).toBeNull();
    const name = screen.getByLabelText(defaultCalendarLabels.calendarNameLabel);
    await expect(name).toHaveValue("team-offsite");
    await expect(
      screen.getByRole("button", { name: defaultCalendarLabels.importSubmit }),
    ).not.toBeDisabled();
    await userEvent.clear(name);
    await expect(
      screen.getByRole("button", { name: defaultCalendarLabels.importSubmit }),
    ).toBeDisabled();
  },
};

export const InvalidFile: Story = {
  tags: ["vitest-ci"],
  args: {
    error: defaultCalendarLabels.importFileInvalid,
  },
};
