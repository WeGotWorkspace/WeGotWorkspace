import type { Meta, StoryObj } from "@storybook/react-vite";
import { DriveDetailActionBar } from "@/drive-core/src/drive-detail-action-bar";
import { buildDriveFileActions } from "@/drive-core/src/drive-file-action-builders";
import { driveStoryLabels } from "@/drive-core/stories/drive-pane-stories.fixtures";
import {
  driveStoryParameters,
  STORY_NOOP,
  storyBooleanControl,
} from "@/drive-core/stories/drive-story-shared";
import { DriveStoryScope } from "@/drive-core/stories/drive-story-scope";

const meta = {
  title: "Apps/Drive/Components/DriveDetailActionBar",
  component: DriveDetailActionBar,
  tags: ["autodocs"],
  render: (args) => <DriveDetailActionBar {...args} />,
  decorators: [
    (Story, context) => {
      if (context.parameters.narrowAside) {
        return (
          <DriveStoryScope className="flex min-h-[12rem] justify-end bg-[color-mix(in_oklab,var(--color-ink)_4%,transparent)] p-6">
            <div
              className="drive-detail-aside flex flex-col border-l"
              data-open="true"
              style={{ width: "min(33.333%, 22rem)" }}
            >
              <Story />
            </div>
          </DriveStoryScope>
        );
      }

      return (
        <DriveStoryScope>
          <Story />
        </DriveStoryScope>
      );
    },
  ],
  parameters: driveStoryParameters({
    snippet: `<DriveDetailActionBar
  actions={buildDriveFileActions(driveLabels, { isStarred: false, inTrash: false }, {
    onDownload: () => {},
    onStar: () => {},
    onDelete: () => {},
  })}
  onClose={() => {}}
/>`,
  }),
  argTypes: {
    mobile: storyBooleanControl,
  },
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
    onClose: STORY_NOOP,
    mobile: false,
  },
};

export const Starred: Story = {
  args: {
    actions: storyActions(true, false),
    onClose: STORY_NOOP,
    mobile: false,
  },
};

export const InTrash: Story = {
  name: "In trash",
  args: {
    actions: storyActions(false, true),
    onClose: STORY_NOOP,
    mobile: false,
  },
};

export const Mobile: Story = {
  args: {
    actions: storyActions(false, false),
    onClose: STORY_NOOP,
    mobile: true,
  },
  globals: {
    viewport: {
      value: "mobile1",
      isRotated: false,
    },
  },
};

export const NarrowAside: Story = {
  name: "Narrow aside (container query)",
  parameters: {
    narrowAside: true,
    docs: {
      description: {
        story:
          "Desktop detail aside width (~22rem). Actions collapse into the overflow menu when the ActionBar container is under 28rem (shared container query), not via viewport breakpoints.",
      },
    },
  },
  args: {
    actions: storyActions(false, false),
    onClose: STORY_NOOP,
    mobile: false,
  },
  globals: {
    viewport: {
      value: "desktop",
      isRotated: false,
    },
  },
};
