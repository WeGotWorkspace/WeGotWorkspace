import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { DriveMoveToDialog } from "@/drive-core/src/drive-move-to-dialog";
import { driveLabels } from "@/drive-core/src/drive-labels";
import { DRIVE_MOCK_FILES } from "@/drive-core/src/drive-mock-files";
import { getDriveStoryFilesInMyDrive } from "@/drive-core/stories/drive-pane-stories.fixtures";
import { STORY_NOOP } from "@/drive-core/stories/drive-story-shared";
import { DriveStoryScope } from "@/drive-core/stories/drive-story-scope";

function FolderDestinationHarness() {
  const [open, setOpen] = useState(true);
  return (
    <DriveStoryScope className="max-w-lg p-6">
      <DriveMoveToDialog
        open={open}
        labels={driveLabels}
        files={getDriveStoryFilesInMyDrive()}
        groupPaths={["Groups/Engineering"]}
        moveIds={["f2"]}
        view={{ type: "folder", path: "My Drive" }}
        currentUsername="alice"
        groupRootNames={new Set(["Engineering"])}
        onClose={() => setOpen(false)}
        onConfirm={STORY_NOOP}
      />
    </DriveStoryScope>
  );
}

function FileSelectHarness() {
  const [open, setOpen] = useState(true);
  return (
    <DriveStoryScope className="max-w-2xl p-6">
      <DriveMoveToDialog
        open={open}
        mode="file-select"
        labels={driveLabels}
        files={DRIVE_MOCK_FILES}
        groupPaths={["Groups/Engineering"]}
        view={{ type: "folder", path: "My Drive" }}
        currentUsername="alice"
        groupRootNames={new Set(["Engineering"])}
        onClose={() => setOpen(false)}
        onSelectFile={STORY_NOOP}
        onUploadFiles={STORY_NOOP}
      />
    </DriveStoryScope>
  );
}

const meta = {
  title: "Apps/Drive/Components/DriveMoveToDialog",
  component: DriveMoveToDialog,
  tags: ["autodocs"],
} satisfies Meta<typeof DriveMoveToDialog>;

export default meta;
type Story = StoryObj<typeof DriveMoveToDialog>;

export const Default: Story = {
  render: () => <FolderDestinationHarness />,
};

export const FileSelect: Story = {
  name: "File select (insert image)",
  render: () => <FileSelectHarness />,
};
