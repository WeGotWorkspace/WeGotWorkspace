import type { Meta, StoryObj } from "@storybook/react-vite";
import { FolderInput, Star, Trash2 } from "lucide-react";
import { expect, fn, userEvent, within } from "storybook/test";
import { DriveDetailPanel } from "@/drive-core/src/drive-detail-panel";
import {
  getDriveStoryFile,
  driveStoryLabels,
} from "@/drive-core/stories/drive-pane-stories.fixtures";
import { driveStoryParameters, STORY_NOOP } from "@/drive-core/stories/drive-story-shared";
import { DriveStoryScope } from "@/drive-core/stories/drive-story-scope";

const now = new Date();
const yesterdayNoon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12);
const yesterdayLabel = (() => {
  const text = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(-1, "day");
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
})();

const meta = {
  title: "Features/Drive/Components/DriveDetailPanel",
  component: DriveDetailPanel,
  tags: ["autodocs", "vitest-ci"],
  decorators: [
    (Story) => (
      <DriveStoryScope>
        <div className="workspace-app-layout__panel" style={{ height: 560, width: 320 }}>
          <Story />
        </div>
      </DriveStoryScope>
    ),
  ],
  parameters: driveStoryParameters({
    snippet: `<DriveDetailPanel
  labels={driveLabels}
  file={file}
  locationLabel="Personal / Projects"
  selectedCount={selectedIds.length}
  selectionActions={selectionBarButtons}
  onClose={() => {}}
/>`,
  }),
  args: {
    labels: driveStoryLabels,
    onClose: STORY_NOOP,
    file: {
      ...getDriveStoryFile(),
      title: "Quarterly plan.pdf",
      modifiedMs: yesterdayNoon.getTime(),
    },
    locationLabel: "Personal / Projects",
  },
} satisfies Meta<typeof DriveDetailPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * One item: its location in the drive names the sidebar and breadcrumb use, and
 * the same labels as the list column headers (no uppercase).
 */
export const SingleItem: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Personal / Projects")).toBeInTheDocument();
    const label = canvas.getByText(driveStoryLabels.listColumnLastModified);
    await expect(getComputedStyle(label).textTransform).toBe("none");
    await expect(canvas.getByText(driveStoryLabels.listColumnKind)).toBeInTheDocument();
    await expect(canvas.getByText(yesterdayLabel)).toBeInTheDocument();
  },
};

const onMove = fn();

/** Several items: the compact selection summary with the selection bar's actions. */
export const MultipleSelection: Story = {
  args: {
    selectedCount: 4,
    selectionActions: [
      { id: "star", label: "Star", icon: <Star className="size-4" /> },
      { id: "move", label: "Move", icon: <FolderInput className="size-4" />, onClick: onMove },
      { id: "trash", label: "Delete", icon: <Trash2 className="size-4" /> },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(driveStoryLabels.detailMultipleSelection)).toBeInTheDocument();
    await expect(canvas.getByText("4 items selected")).toBeInTheDocument();
    await expect(canvas.queryByText("Quarterly plan.pdf")).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Move" }));
    await expect(onMove).toHaveBeenCalled();
  },
};

/** Nothing selected: the shared empty placeholder. */
export const Empty: Story = {
  args: { file: null },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(driveStoryLabels.detailEmpty)).toBeInTheDocument();
  },
};
