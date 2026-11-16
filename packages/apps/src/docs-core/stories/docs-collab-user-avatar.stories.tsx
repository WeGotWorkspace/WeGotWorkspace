import type { Meta, StoryObj } from "@storybook/react-vite";
import { UserAvatar, avatarColorForUserId } from "@/user-avatar/src/user-avatar";
import "@/workspace-shell/src/workspace-app-layout.css";
import "@/docs-core/src/docs-workspace.css";
import "@/text-editor-core/docs-collab/docs-collab-presence.css";

/** The shared avatar in the Docs collab presence stack (moved from the User Avatar stories, #1638). */
const meta: Meta<typeof UserAvatar> = {
  title: "UI/Primitives/User Avatar (Docs collab)",
  component: UserAvatar,
};

export default meta;
type Story = StoryObj<typeof UserAvatar>;

/** Docs/notes collab peer stack (overlapping xs marks). */
export const CollabPeerStack: Story = {
  render: () => (
    <div className="docs-workspace p-4">
      <div className="docs-collab-presence" aria-label="Connected editors">
        <span className="docs-collab-presence__chip">
          <UserAvatar
            displayName="Alex Example"
            compact
            size="xs"
            className="docs-collab-presence__avatar docs-collab-presence__avatar--self"
          />
        </span>
        <span className="docs-collab-presence__chip docs-collab-presence__chip--overlap">
          <UserAvatar
            displayName="Sam Lee"
            compact
            size="xs"
            color={avatarColorForUserId("peer-1")}
            className="docs-collab-presence__avatar"
          />
        </span>
        <span className="docs-collab-presence__chip docs-collab-presence__chip--overlap">
          <UserAvatar
            displayName="Jordan Kim"
            compact
            size="xs"
            color={avatarColorForUserId("peer-2")}
            className="docs-collab-presence__avatar"
          />
        </span>
      </div>
    </div>
  ),
};
