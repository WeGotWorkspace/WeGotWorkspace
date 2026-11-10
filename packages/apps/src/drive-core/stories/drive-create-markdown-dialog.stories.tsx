import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import {
  DriveCreateMarkdownDialog,
  type DriveCreateDialogKind,
} from "@/drive-core/src/drive-create-markdown-dialog";
import { driveLabels } from "@/drive-core/src/drive-labels";
import { DRIVE_MOCK_FILES } from "@/drive-core/src/drive-mock-files";
import { getDriveStoryFilesInMyDrive } from "@/drive-core/stories/drive-pane-stories.fixtures";
import { STORY_NOOP } from "@/drive-core/stories/drive-story-shared";
import { DriveStoryScope } from "@/drive-core/stories/drive-story-scope";

function CreateMarkdownDialogHarness({
  kind = "document",
  defaultName = "Untitled.md",
  initialBrowsePath = "My Drive",
  onConfirm = STORY_NOOP,
}: {
  kind?: DriveCreateDialogKind;
  defaultName?: string;
  initialBrowsePath?: string;
  onConfirm?: (name: string, destinationPath: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const files = getDriveStoryFilesInMyDrive();

  return (
    <DriveStoryScope className="max-w-lg p-6">
      <DriveCreateMarkdownDialog
        open={open}
        kind={kind}
        labels={driveLabels}
        defaultName={defaultName}
        initialBrowsePath={initialBrowsePath}
        files={files}
        groupPaths={["Groups/Engineering"]}
        view={{ type: "folder", path: initialBrowsePath }}
        currentUsername="alice"
        groupRootNames={new Set(["Engineering"])}
        onClose={() => setOpen(false)}
        onConfirm={onConfirm}
      />
    </DriveStoryScope>
  );
}

const meta = {
  title: "Features/Drive/Components/DriveCreateMarkdownDialog",
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

const onCreateFolder = fn();

/**
 * New folder (Drive): the same dialog, no extension. The picker opens on the
 * folder in view and that folder is chosen, so Create folder works at once.
 */
export const NewFolder: Story = {
  tags: ["vitest-ci"],
  render: () => (
    <CreateMarkdownDialogHarness
      kind="folder"
      defaultName=""
      initialBrowsePath="My Drive"
      onConfirm={onCreateFolder}
    />
  ),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = within(
      await body.findByRole("dialog", { name: driveLabels.createFolderDialogTitle }),
    );
    const create = dialog.getByRole("button", { name: driveLabels.createFolderDialogConfirm });
    await expect(create).toBeDisabled();
    await userEvent.type(
      dialog.getByPlaceholderText(driveLabels.createFolderDialogNamePlaceholder),
      "Plans",
    );
    await expect(dialog.queryByText(".md")).not.toBeInTheDocument();
    await waitFor(() => expect(create).toBeEnabled());
    await userEvent.click(create);
    await expect(onCreateFolder).toHaveBeenCalledWith("Plans", "My Drive");
  },
};
