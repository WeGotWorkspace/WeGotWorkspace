import type { Meta, StoryObj } from "@storybook/react-vite";
import { DriveNewMenu } from "@/drive-core/src/drive-new-menu";
import { driveStoryLabels } from "@/drive-core/stories/drive-pane-stories.fixtures";
import { STORY_NOOP } from "@/drive-core/stories/drive-story-shared";
import { DriveStoryScope } from "@/drive-core/stories/drive-story-scope";

const meta = {
  title: "Features/Drive/Components/DriveNewMenu",
  component: DriveNewMenu,
  tags: ["autodocs"],
  render: (args) => (
    <DriveStoryScope className="max-w-xs p-6">
      <DriveNewMenu {...args} />
    </DriveStoryScope>
  ),
} satisfies Meta<typeof DriveNewMenu>;

export default meta;
type Story = StoryObj<typeof DriveNewMenu>;

export const Default: Story = {
  args: {
    labels: driveStoryLabels,
    onCreateFolder: STORY_NOOP,
    onUploadFiles: STORY_NOOP,
    onCreateMarkdown: STORY_NOOP,
  },
};
