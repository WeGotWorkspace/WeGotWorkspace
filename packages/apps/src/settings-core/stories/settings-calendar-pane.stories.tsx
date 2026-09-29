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
    await expect(canvas.getByRole("combobox", { name: "Timezone" })).toBeTruthy();
    await expect(canvas.getByRole("combobox", { name: "Day starts on" })).toBeTruthy();
    const calendarTrigger = await canvas.findByRole("button", {
      name: /Default calendar: Personal/i,
    });
    await expect(calendarTrigger).toBeTruthy();
    await expect(calendarTrigger.textContent).toContain("Personal");
    await expect(canvas.queryByRole("combobox", { name: "Language" })).toBeNull();
    await expect(canvas.queryByRole("combobox", { name: /working hours/i })).toBeNull();
  },
};
