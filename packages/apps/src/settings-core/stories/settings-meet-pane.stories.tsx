import type { Meta, StoryObj } from "@storybook/react-vite";
import { SettingsMeetPane } from "@/settings-core/src/settings-meet-pane";
import { SettingsStoryScope } from "./settings-story-scope";

const meta = {
  title: "Features/Settings/Meet pane",
  component: SettingsMeetPane,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <SettingsStoryScope>
        <Story />
      </SettingsStoryScope>
    ),
  ],
} satisfies Meta<typeof SettingsMeetPane>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
