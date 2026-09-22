import type { Meta, StoryObj } from "@storybook/react-vite";
import { createBrandingStoryMeta } from "@/branding-playground";
import {
  createDriveAppBootstrap,
  createMockDriveShareOperations,
} from "@/lib/api/mock/drive-bootstrap";
import { DriveWorkspace } from "@/drive-core/src/drive-workspace";
import { STORY_NOOP } from "@/drive-core/stories/drive-story-shared";

const brandingMeta = createBrandingStoryMeta({
  appId: "drive",
  workspaceClass: "drive-workspace",
  accentToken: "drive-accent",
  component: DriveWorkspace,
});

const meta = {
  ...brandingMeta,
  title: "Branding/Drive",
  tags: ["vitest-ci"],
} satisfies Meta<typeof DriveWorkspace>;

export default meta;
type Story = StoryObj<typeof DriveWorkspace>;

export const Default: Story = {
  args: {
    ...createDriveAppBootstrap(),
    shareOperations: createMockDriveShareOperations(),
    onLogout: () => {},
    onOpenDocsFile: STORY_NOOP,
    onNavigate: STORY_NOOP,
  },
};
