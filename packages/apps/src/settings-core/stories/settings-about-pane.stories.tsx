import type { Meta, StoryObj } from "@storybook/react-vite";
import { SettingsAboutPane } from "@/settings-core/src/settings-about-pane";
import { SettingsStoryScope } from "./settings-story-scope";

const meta = {
  title: "Features/Settings/About pane",
  component: SettingsAboutPane,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <SettingsStoryScope>
        <Story />
      </SettingsStoryScope>
    ),
  ],
} satisfies Meta<typeof SettingsAboutPane>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
