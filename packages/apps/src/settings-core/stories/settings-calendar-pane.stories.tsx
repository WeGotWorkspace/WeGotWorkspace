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
    await expect(canvas.getByRole("combobox", { name: "Language" })).toBeTruthy();
    await expect(canvas.getByRole("combobox", { name: "Day starts on" })).toBeTruthy();
    await expect(
      canvas.findByRole("button", { name: /Incoming invites: Personal/i }),
    ).resolves.toBeTruthy();
    await expect(canvas.queryByRole("combobox", { name: /working hours/i })).toBeNull();
  },
};
