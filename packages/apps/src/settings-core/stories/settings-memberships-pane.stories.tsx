import type { Meta, StoryObj } from "@storybook/react-vite";
import { SettingsMembershipsPane } from "@/settings-core/src/settings-memberships-pane";
import { createMockGroups } from "./settings-panes.stories.fixtures";
import { SettingsStoryScope } from "./settings-story-scope";

const meta = {
  title: "Shared/Settings/Panes/Memberships",
  component: SettingsMembershipsPane,
  render: (args) => (
    <SettingsStoryScope>
      <SettingsMembershipsPane {...args} />
    </SettingsStoryScope>
  ),
  parameters: {
    layout: "fullscreen",
  },
  argTypes: {
    groups: { control: false },
  },
} satisfies Meta<typeof SettingsMembershipsPane>;

export default meta;
type Story = StoryObj<typeof SettingsMembershipsPane>;

export const Default: Story = {
  args: {
    groups: createMockGroups(),
  },
};

export const SingleGroup: Story = {
  args: {
    groups: createMockGroups([
      { id: "principals/groups/editorial", displayName: "Editorial Team" },
    ]),
  },
};
