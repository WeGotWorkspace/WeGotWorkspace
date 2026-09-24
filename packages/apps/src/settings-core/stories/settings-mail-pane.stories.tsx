import type { Meta, StoryObj } from "@storybook/react-vite";
import { SettingsMailPane } from "@/settings-core/src/settings-mail-pane";
import { SettingsStoryScope } from "./settings-story-scope";

const meta = {
  title: "Features/Settings/Panes/Mail",
  component: SettingsMailPane,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof SettingsMailPane>;

export default meta;
type Story = StoryObj<typeof SettingsMailPane>;

export const Unshipped: Story = {
  render: () => (
    <SettingsStoryScope>
      <SettingsMailPane />
    </SettingsStoryScope>
  ),
};
