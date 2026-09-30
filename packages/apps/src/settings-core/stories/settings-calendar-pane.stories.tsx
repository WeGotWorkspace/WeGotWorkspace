import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { SettingsCalendarPane } from "@/settings-core/src/settings-calendar-pane";
import { SettingsStoryScope } from "./settings-story-scope";

const meta = {
  title: "Features/Settings/Panes/Calendar",
  component: SettingsCalendarPane,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof SettingsCalendarPane>;

export default meta;
type Story = StoryObj<typeof SettingsCalendarPane>;

export const Display: Story = {
  render: () => (
    <SettingsStoryScope>
      <SettingsCalendarPane />
    </SettingsStoryScope>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const calendarTrigger = await canvas.findByRole("button", {
      name: /Default calendar: Personal/i,
    });
    const timezone = canvas.getByRole("combobox", { name: "Timezone" });
    const visibleHours = canvas.getByRole("combobox", { name: "Visible hours" });
    await expect(calendarTrigger.textContent).toContain("Personal");
    await expect(
      calendarTrigger.compareDocumentPosition(timezone) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    await expect(
      timezone.compareDocumentPosition(visibleHours) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    await expect(visibleHours.textContent).toMatch(/12 hours/);
    await expect(canvas.queryByRole("combobox", { name: "Language" })).toBeNull();
    await expect(canvas.queryByRole("combobox", { name: "Day starts on" })).toBeNull();
    await expect(canvas.queryByRole("combobox", { name: "Starts at" })).toBeNull();
    await expect(canvas.queryByRole("option", { name: "Default" })).toBeNull();
    await expect(canvas.queryByRole("combobox", { name: /working hours/i })).toBeNull();
  },
};
