import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import {
  createMockCalendarAvailabilitySettingsOperations,
  mockCalendarAvailabilitySettings,
} from "@/lib/api/mock/calendar-availability-settings";
import type { CalendarAvailabilitySettingsOperations } from "@/lib/api/wgw/calendar-availability";
import { calendarAvailabilityLabels as labels } from "@/settings-core/src/settings-calendar-availability-labels";
import { SettingsCalendarAvailabilitySection } from "@/settings-core/src/settings-calendar-availability-section";
import { SettingsStoryScope } from "./settings-story-scope";

const meta = {
  title: "Features/Settings/Panes/Calendar availability",
  component: SettingsCalendarAvailabilitySection,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof SettingsCalendarAvailabilitySection>;

export default meta;
type Story = StoryObj<typeof SettingsCalendarAvailabilitySection>;

function story(operations: CalendarAvailabilitySettingsOperations): Story["render"] {
  return () => (
    <SettingsStoryScope>
      <SettingsCalendarAvailabilitySection operations={operations} />
    </SettingsStoryScope>
  );
}

const threeCalendars = mockCalendarAvailabilitySettings({
  enabled: true,
  calendars: [
    {
      calendarId: "default",
      name: "Personal",
      color: "#6366f1",
      source: "personal",
      include: true,
      detail: "details",
    },
    {
      calendarId: "work",
      name: "Work",
      color: "#0ea5e9",
      source: "personal",
      include: false,
      detail: "busy",
    },
    {
      calendarId: "group-editorial",
      name: "Editorial",
      color: "#22c55e",
      source: "team",
      include: true,
      detail: "busy",
    },
  ],
});

/** Off by default: one explanatory line, no calendars. */
export const SwitchOff: Story = {
  render: story(createMockCalendarAvailabilitySettingsOperations()),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const toggle = await canvas.findByRole("switch", { name: labels.switch });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(canvas.getByText(labels.offHint)).toBeInTheDocument();
    await expect(canvas.queryByText(labels.calendarsHeading)).toBeNull();
  },
};

/** On, but the owner has no calendar that can count yet. */
export const OnWithoutCalendars: Story = {
  render: story(
    createMockCalendarAvailabilitySettingsOperations(
      mockCalendarAvailabilitySettings({ enabled: true, calendars: [] }),
    ),
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText(labels.calendarsNone)).toBeInTheDocument();
    await expect(canvas.getByText(labels.calendarsHeading)).toBeInTheDocument();
  },
};

/** Personal with title and location, Work set to "Do not add", and one Team calendar. */
export const OnWithThreeCalendars: Story = {
  render: story(createMockCalendarAvailabilitySettingsOperations(threeCalendars)),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const personal = await canvas.findByRole("combobox", { name: "Personal" });
    await expect(personal.textContent).toContain(labels.detailDetails);
    const work = canvas.getByRole("combobox", { name: "Work" });
    await expect(work.textContent).toContain(labels.exclude);
    const editorial = canvas.getByRole("combobox", { name: "Editorial" });
    await expect(editorial.textContent).toContain(labels.detailBusy);
    await expect(canvas.queryByRole("checkbox")).toBeNull();
    await expect(canvas.queryByText("Design")).toBeNull();
  },
};

/** Turning the switch on and saving keeps the pane on, with Save disabled again. */
export const TurnOnAndSave: Story = {
  render: story(createMockCalendarAvailabilitySettingsOperations()),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const save = await canvas.findByRole("button", { name: "Save" });
    await expect(save).toBeDisabled();
    await userEvent.click(canvas.getByRole("switch", { name: labels.switch }));
    await expect(canvas.getByText("Editorial", { selector: "span" })).toBeInTheDocument();
    await userEvent.click(save);
    await expect(await canvas.findByRole("button", { name: "Save" })).toBeDisabled();
    await expect(canvas.getByRole("switch", { name: labels.switch })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  },
};

/** Opened without a connection: the pane needs one and says so. */
export const Offline: Story = {
  render: story({
    load: () => Promise.reject(new TypeError("Failed to fetch")),
    save: () => Promise.reject(new TypeError("Failed to fetch")),
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText(labels.offline)).toBeInTheDocument();
  },
};

/** The server failed: an error line with Try again. */
export const LoadError: Story = {
  render: story({
    load: () => Promise.reject(new Error("GET /calendars/availability failed (500)")),
    save: () => Promise.reject(new Error("unused")),
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText(labels.loadError)).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: labels.retry })).toBeInTheDocument();
  },
};

/** The short whole-Team label opens as the suite tooltip on the "Team" tag (hover or keyboard focus). */
export const TeamTagTooltip: Story = {
  render: story(createMockCalendarAvailabilitySettingsOperations(threeCalendars)),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const tag = await canvas.findByText(labels.teamBadge);
    await userEvent.hover(tag);
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByRole("tooltip")).toHaveTextContent("Counts for the whole Team");
    await expect(tag).toHaveAccessibleDescription(labels.teamHint);
  },
};
