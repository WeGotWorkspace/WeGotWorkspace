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

const twoTeamsThreeCalendars = mockCalendarAvailabilitySettings({
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

/** Off by default: one explanatory line, no Teams or calendars. */
export const SwitchOff: Story = {
  render: story(createMockCalendarAvailabilitySettingsOperations()),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const toggle = await canvas.findByRole("switch", { name: labels.switch });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(canvas.getByText(labels.offHint)).toBeInTheDocument();
    await expect(canvas.queryByText(labels.teamsHeading)).toBeNull();
    await expect(canvas.queryByText(labels.footer)).toBeNull();
  },
};

/** On, but the owner is in no Team yet. */
export const OnWithoutTeams: Story = {
  render: story(
    createMockCalendarAvailabilitySettingsOperations(
      mockCalendarAvailabilitySettings({ enabled: true, teams: [] }),
    ),
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText(labels.teamsNone)).toBeInTheDocument();
    await expect(canvas.getByText(labels.footer)).toBeInTheDocument();
  },
};

/** Two Teams, two personal calendars (Work unchecked) and one Team calendar. */
export const OnWithTwoTeamsAndThreeCalendars: Story = {
  render: story(createMockCalendarAvailabilitySettingsOperations(twoTeamsThreeCalendars)),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Design")).toBeInTheDocument();
    const work = canvas.getByRole("combobox", { name: `${labels.detail} Work` });
    await expect(work).toBeDisabled();
    const personal = canvas.getByRole("combobox", { name: `${labels.detail} Personal` });
    await expect(personal).toBeEnabled();
    await expect(personal.textContent).toContain(labels.detailDetails);
    await expect(canvas.getByText(labels.teamHint)).toBeInTheDocument();
    await expect(canvas.queryByRole("combobox", { name: `${labels.detail} Editorial` })).toBeNull();
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
