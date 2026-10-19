import type { Meta, StoryObj } from "@storybook/react-vite";
import { SettingsAppearancePane } from "@/settings-core/src/settings-appearance-pane";
import { SettingsStoryScope } from "./settings-story-scope";

const meta = {
  title: "Features/Settings/Appearance pane",
  component: SettingsAppearancePane,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <SettingsStoryScope>
        <Story />
      </SettingsStoryScope>
    ),
  ],
} satisfies Meta<typeof SettingsAppearancePane>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
