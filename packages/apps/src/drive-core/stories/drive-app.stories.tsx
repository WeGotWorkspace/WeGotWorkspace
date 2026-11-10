import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import {
  createDriveAppBootstrap,
  createMockDriveShareOperations,
} from "@/lib/api/mock/drive-bootstrap";
import { DriveWorkspace } from "@/drive-core/src/drive-workspace";
import { STORY_NOOP } from "@/drive-core/stories/drive-story-shared";

const meta: Meta<typeof DriveWorkspace> = {
  title: "Features/Drive",
  component: DriveWorkspace,
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;
type Story = StoryObj<typeof DriveWorkspace>;

/** Chrome Default lives under Themes/Drive — Shared with me view. */
export const SharedWithMe: Story = {
  args: {
    ...createDriveAppBootstrap(),
    shareOperations: createMockDriveShareOperations(),
    view: { type: "shared" },
    onViewChange: STORY_NOOP,
    onLogout: () => {},
    onOpenDocsFile: STORY_NOOP,
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

/**
 * Inside a folder the header title is the folder name; parent folders sit before it
 * as links (no separate breadcrumb bar). A parent link opens that folder.
 */
export const FolderPathInHeader: Story = {
  tags: ["vitest-ci"],
  args: {
    ...createDriveAppBootstrap(),
    shareOperations: createMockDriveShareOperations(),
    view: { type: "folder", path: "My Drive/Studio Assets" },
    onViewChange: fn(),
    onLogout: () => {},
    onOpenDocsFile: STORY_NOOP,
  },
  play: async ({ args, canvasElement }) => {
    const header = canvasElement.querySelector<HTMLElement>(".drive-workspace .view-header");
    if (!header) throw new Error("Expected the Drive view header");
    const scope = within(header);
    await expect(await scope.findByRole("heading", { name: "Studio Assets" })).toBeInTheDocument();
    await expect(canvasElement.querySelector(".drive-main-pane__breadcrumbs")).toBeNull();

    const trail = scope.getByRole("navigation", { name: "Breadcrumb" });
    const [driveRoot] = within(trail).getAllByRole("button");
    await userEvent.click(driveRoot);
    await expect(args.onViewChange).toHaveBeenCalledWith({ type: "folder", path: "My Drive" });
  },
};
