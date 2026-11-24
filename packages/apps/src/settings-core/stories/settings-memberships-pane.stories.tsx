import type { Meta, StoryObj } from "@storybook/react-vite";
import { SettingsMembershipsPane } from "@/settings-core/src/settings-memberships-pane";
import { createMockGroups } from "./settings-panes.stories.fixtures";
import { SettingsStoryScope } from "./settings-story-scope";

const meta = {
  title: "Features/Settings/Panes/Memberships",
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

/** The demo user runs Editorial Team: that row has "Manage members". */
export const Default: Story = {
  args: {
    groups: createMockGroups(),
    currentUsername: "demo.user",
  },
};

/** A plain member of every Team: the pane as it was before team admins. */
export const PlainMember: Story = {
  args: {
    groups: createMockGroups().map((group) => ({ ...group, isTeamAdmin: false })),
    currentUsername: "demo.user",
  },
};

export const SingleGroup: Story = {
  args: {
    groups: createMockGroups([
      {
        id: "principals/groups/editorial",
        displayName: "Editorial Team",
        memberCount: 6,
        isTeamAdmin: true,
      },
    ]),
    currentUsername: "demo.user",
  },
};

/** The viewer is in no Team (#1924). */
export const NoTeam: Story = {
  args: {
    groups: [],
    currentUsername: "demo.user",
  },
};
