import type { Meta, StoryObj } from "@storybook/react-vite";
import { SettingsOfflinePane } from "@/settings-core/src/settings-offline-pane";
import { SettingsStoryScope } from "./settings-story-scope";

const meta = {
  title: "Features/Settings/Offline pane",
  component: SettingsOfflinePane,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <SettingsStoryScope>
        <Story />
      </SettingsStoryScope>
    ),
  ],
} satisfies Meta<typeof SettingsOfflinePane>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
