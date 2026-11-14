import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { DriveMoveToDialog } from "@/drive-core/src/drive-move-to-dialog";
import { DRIVE_FOLDER_PICKER_ROOT } from "@/drive-core/src/drive-breadcrumbs";
import { driveLabels } from "@/drive-core/src/drive-labels";
import { DRIVE_MOCK_FILES } from "@/drive-core/src/drive-mock-files";
import { STORY_NOOP } from "@/drive-core/stories/drive-story-shared";
import { docsLabels } from "@/docs-core/src/docs-labels";
import "@/docs-core/src/docs-workspace.css";

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
      dialogSurfaceClassName="docs-dialog-surface"
      onClose={() => setOpen(false)}
      onSelectFile={STORY_NOOP}
    />
  );
}

/** Docs' "Insert image" picker: Drive's move dialog in file-select mode with Docs labels. */
const meta = {
  title: "Features/Docs/Components/Insert image picker",
  component: DriveMoveToDialog,
  tags: ["autodocs"],
} satisfies Meta<typeof DriveMoveToDialog>;

export default meta;
type Story = StoryObj<typeof DriveMoveToDialog>;

export const FileSelect: Story = {
  name: "File select (insert image)",
  render: () => <FileSelectHarness />,
};
