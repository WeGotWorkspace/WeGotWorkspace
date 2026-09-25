import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { DriveDetailActionBar } from "@/drive-core/src/drive-detail-action-bar";
import { buildDriveFileActions } from "@/drive-core/src/drive-file-action-builders";
import { driveStoryLabels } from "@/drive-core/stories/drive-pane-stories.fixtures";
import { driveStoryParameters, STORY_NOOP } from "@/drive-core/stories/drive-story-shared";
import { DriveStoryScope } from "@/drive-core/stories/drive-story-scope";
import "@/drive-core/src/drive-detail-panel.css";

const onDeletePermanently = fn();

const meta = {
  title: "Features/Drive/Components/DriveDetailActionBar",
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

function storyActions(isStarred: boolean, inTrash: boolean, onDelete: () => void = STORY_NOOP) {
  return buildDriveFileActions(
    driveStoryLabels,
    { isStarred, inTrash, canDownload: true },
    {
      onDownload: STORY_NOOP,
      onStar: STORY_NOOP,
      onRename: STORY_NOOP,
      onDelete,
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
  tags: ["vitest-ci"],
  args: {
    actions: storyActions(false, true, onDeletePermanently),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    const more = await canvas.findByRole("button", { name: "More actions" });
    await expect(more).toBeEnabled();
    await userEvent.click(more);
    const menu = await body.findByRole("menu");
    const deletePermanently = await within(menu).findByRole("button", {
      name: driveStoryLabels.selectionDeletePermanently,
    });
    await expect(deletePermanently).toBeEnabled();
    await userEvent.click(deletePermanently);
    await expect(onDeletePermanently).toHaveBeenCalledOnce();
  },
};
