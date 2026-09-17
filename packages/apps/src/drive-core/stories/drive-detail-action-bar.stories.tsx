import type { Meta, StoryObj } from "@storybook/react-vite";
import { DriveDetailActionBar } from "@/drive-core/src/drive-detail-action-bar";
import { buildDriveFileActions } from "@/drive-core/src/drive-file-action-builders";
import { driveStoryLabels } from "@/drive-core/stories/drive-pane-stories.fixtures";
import { driveStoryParameters, STORY_NOOP } from "@/drive-core/stories/drive-story-shared";
import { DriveStoryScope } from "@/drive-core/stories/drive-story-scope";
import "@/drive-core/src/drive-detail-panel.css";

const meta = {
  title: "Apps/Drive/Components/DriveDetailActionBar",
  component: DriveDetailActionBar,
  tags: ["autodocs"],
  render: (args) => <DriveDetailActionBar {...args} />,
  decorators: [
    (Story) => (
      <DriveStoryScope>
        <div className="drive-detail-panel flex justify-end p-4">
          <Story />
        </div>
      </DriveStoryScope>
    ),
  ],
  parameters: driveStoryParameters({
    snippet: `<DriveDetailActionBar
  actions={buildDriveFileActions(driveLabels, { isStarred: false, inTrash: false }, {
    onDownload: () => {},
    onStar: () => {},
    onDelete: () => {},
  })}
/>`,
  }),
} satisfies Meta<typeof DriveDetailActionBar>;

export default meta;
type Story = StoryObj<typeof meta>;

function storyActions(isStarred: boolean, inTrash: boolean) {
  return buildDriveFileActions(
    driveStoryLabels,
    { isStarred, inTrash, canDownload: true },
    {
      onDownload: STORY_NOOP,
      onStar: STORY_NOOP,
      onRename: STORY_NOOP,
      onDelete: STORY_NOOP,
    },
  );
}

export const Default: Story = {
  args: {
    actions: storyActions(false, false),
  },
};

export const Starred: Story = {
  args: {
    actions: storyActions(true, false),
  },
};

export const InTrash: Story = {
  name: "In trash",
  args: {
    actions: storyActions(false, true),
  },
};
