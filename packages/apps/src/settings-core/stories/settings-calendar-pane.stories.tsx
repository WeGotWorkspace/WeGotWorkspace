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
    await expect(canvas.getByRole("combobox", { name: "Locale" })).toBeTruthy();
    await expect(canvas.getByRole("combobox", { name: "Working hours start" })).toBeTruthy();
    await expect(canvas.getByRole("combobox", { name: "Working hours end" })).toBeTruthy();
  },
};
