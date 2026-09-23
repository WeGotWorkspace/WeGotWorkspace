import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { HardDrive } from "lucide-react";
import { DriveMoveToDialog } from "@/drive-core/src/drive-move-to-dialog";
import { DRIVE_FOLDER_PICKER_ROOT } from "@/drive-core/src/drive-breadcrumbs";
import { driveLabels } from "@/drive-core/src/drive-labels";
import { DRIVE_MOCK_FILES } from "@/drive-core/src/drive-mock-files";
import { getDriveStoryFilesInMyDrive } from "@/drive-core/stories/drive-pane-stories.fixtures";
import { STORY_NOOP } from "@/drive-core/stories/drive-story-shared";
import { DriveStoryScope } from "@/drive-core/stories/drive-story-scope";
import { docsLabels } from "@/docs-core/src/docs-labels";
import "@/docs-core/src/docs-workspace.css";

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
    <DriveMoveToDialog
      open={open}
      mode="file-select"
      labels={{ ...driveLabels, fileSelectDialogTitle: docsLabels.insertImageTitle }}
      files={DRIVE_MOCK_FILES}
      groupPaths={["Groups/Engineering"]}
      view={{ type: "folder", path: DRIVE_FOLDER_PICKER_ROOT }}
      currentUsername="alice"
      groupRootNames={new Set(["Engineering"])}
      rootLabels={{ "My Drive": docsLabels.homeMyDrive, "Groups/Engineering": "Engineering" }}
      rootIcon={<HardDrive />}
      dialogSurfaceClassName="docs-dialog-surface"
      onClose={() => setOpen(false)}
      onSelectFile={STORY_NOOP}
    />
  );
}

const meta = {
  title: "Features/Drive/Components/DriveMoveToDialog",
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
