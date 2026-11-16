import type { Meta, StoryObj } from "@storybook/react-vite";
import { UserAvatar } from "@/user-avatar/src/user-avatar";
import "@/meet-core/src/meet-workspace.css";
import "@/workspace-shell/src/workspace-app-layout.css";

/** The shared avatar on Meet's dark workspace tokens (moved from the User Avatar stories, #1638). */
const meta: Meta<typeof UserAvatar> = {
  title: "UI/Primitives/User Avatar (Meet)",
  component: UserAvatar,
};

export default meta;
type Story = StoryObj<typeof UserAvatar>;

/** Meet lobby / peer tile: compact chip on dark workspace tokens. */
export const MeetLobbyPreview: Story = {
  render: () => (
    <div
      className="meet-workspace flex min-h-48 items-center justify-center p-8"
      style={{ background: "var(--meet-surface)" }}
    >
      <UserAvatar displayName="Demo User" compact size="2xl" />
    </div>
  ),
};

/** Meet knock row / compact peer tile sizes. */
export const MeetCompactSizes: Story = {
  render: () => (
    <div
      className="meet-workspace flex items-center gap-4 p-8"
      style={{ background: "var(--meet-surface)" }}
    >
      <UserAvatar displayName="Alex Morgan" compact size="sm" />
      <UserAvatar displayName="Jamie Lee" compact size="md" />
      <UserAvatar displayName="Demo User" compact size="lg" />
    </div>
  ),
};
