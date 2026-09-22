import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { DriveCreateMarkdownDialog } from "@/drive-core/src/drive-create-markdown-dialog";
import { driveLabels } from "@/drive-core/src/drive-labels";
import { DRIVE_MOCK_FILES } from "@/drive-core/src/drive-mock-files";
import { getDriveStoryFilesInMyDrive } from "@/drive-core/stories/drive-pane-stories.fixtures";
import { STORY_NOOP } from "@/drive-core/stories/drive-story-shared";
import { DriveStoryScope } from "@/drive-core/stories/drive-story-scope";

function CreateMarkdownDialogHarness({
  defaultName = "Untitled.md",
  initialBrowsePath = "My Drive",
}: {
  defaultName?: string;
  initialBrowsePath?: string;
}) {
  const [open, setOpen] = useState(true);
  const files = getDriveStoryFilesInMyDrive();

  return (
    <DriveStoryScope className="max-w-lg p-6">
      <DriveCreateMarkdownDialog
        open={open}
        labels={driveLabels}
        defaultName={defaultName}
        initialBrowsePath={initialBrowsePath}
        files={files}
        groupPaths={["Groups/Engineering"]}
        view={{ type: "folder", path: initialBrowsePath }}
        currentUsername="alice"
        groupRootNames={new Set(["Engineering"])}
        onClose={() => setOpen(false)}
        onConfirm={STORY_NOOP}
      />
    </DriveStoryScope>
  );
}

const meta = {
  title: "Shared/Drive/Components/DriveCreateMarkdownDialog",
  component: DriveCreateMarkdownDialog,
  tags: ["autodocs"],
} satisfies Meta<typeof DriveCreateMarkdownDialog>;

export default meta;
type Story = StoryObj<typeof DriveCreateMarkdownDialog>;

export const Default: Story = {
  render: () => <CreateMarkdownDialogHarness />,
};

export const SuggestedName: Story = {
  render: () => (
    <CreateMarkdownDialogHarness
      defaultName="Untitled 3.md"
      initialBrowsePath="My Drive/Projects"
    />
  ),
};

export const WithMockFiles: Story = {
  render: () => (
    <DriveStoryScope className="max-w-lg p-6">
      <DriveCreateMarkdownDialog
        open
        labels={driveLabels}
        defaultName="Untitled.md"
        initialBrowsePath="My Drive"
        files={DRIVE_MOCK_FILES}
        groupPaths={[]}
        view={{ type: "folder", path: "My Drive" }}
        currentUsername="alice"
        groupRootNames={new Set()}
        onClose={STORY_NOOP}
        onConfirm={STORY_NOOP}
      />
    </DriveStoryScope>
  ),
};
