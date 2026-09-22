import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  createDriveAppBootstrap,
  createMockDriveShareOperations,
} from "@/lib/api/mock/drive-bootstrap";
import { DriveWorkspace } from "@/drive-core/src/drive-workspace";
import { STORY_NOOP } from "@/drive-core/stories/drive-story-shared";

const meta: Meta<typeof DriveWorkspace> = {
  title: "Shared/Drive",
  component: DriveWorkspace,
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;
type Story = StoryObj<typeof DriveWorkspace>;

/** Chrome Default lives under Branding/Drive — Shared with me view. */
export const SharedWithMe: Story = {
  args: {
    ...createDriveAppBootstrap(),
    shareOperations: createMockDriveShareOperations(),
    view: { type: "shared" },
    onViewChange: STORY_NOOP,
    onLogout: () => {},
    onOpenDocsFile: STORY_NOOP,
    onNavigate: STORY_NOOP,
  },
  parameters: {
    docs: {
      description: {
        story:
          "Sidebar **Shared with me** (`?view=shared`) lists member-shared files and folders from other users.",
      },
    },
  },
};
