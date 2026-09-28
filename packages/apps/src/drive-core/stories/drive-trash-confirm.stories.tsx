import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { createDriveAppBootstrap } from "@/lib/api/mock/drive-bootstrap";
import {
  apiPathFromUiPath,
  DRIVE_TRASH_DIR_NAME,
  DRIVE_TRASH_UI_PATH,
  normalizeApiVirtualPath,
} from "@/drive-core/src/drive-path-utils";
import { resolveDriveFileApiPath, resolveTrashName } from "@/drive-core/src/drive-batch-utils";
import type { DriveAPIOperations, DriveUIData } from "@/drive-core/src/drive-types";
import { DriveWorkspaceModals } from "@/drive-core/src/drive-workspace-modals";
import { useDriveShareDialog } from "@/drive-core/src/use-drive-share-dialog";
import {
  driveModalTrashSampleFile,
  useDriveModalStoryController,
} from "@/drive-core/stories/drive-pane-stories.harness";
import { DriveStoryScope } from "@/drive-core/stories/drive-story-scope";

const TRASH_GROUP_ROOTS = new Set<string>();

function trashRenameExpectation() {
  const username = createDriveAppBootstrap().data.user.username;
  const sample = driveModalTrashSampleFile();
  return {
    from: resolveDriveFileApiPath(sample, username, TRASH_GROUP_ROOTS),
    destination: apiPathFromUiPath(DRIVE_TRASH_UI_PATH, username, TRASH_GROUP_ROOTS),
    to: resolveTrashName(sample.title, new Set<string>()),
  };
}

function createDriveTrashStoryOperations(
  renameItem: DriveAPIOperations["renameItem"],
): DriveAPIOperations {
  const bootstrap = createDriveAppBootstrap();
  const username = bootstrap.data.user.username;
  const userRoot = apiPathFromUiPath("My Drive", username, TRASH_GROUP_ROOTS);
  const trashPath = apiPathFromUiPath(DRIVE_TRASH_UI_PATH, username, TRASH_GROUP_ROOTS);
  const data: DriveUIData = {
    ...bootstrap.data,
    cwd: userRoot,
    directory: { ...bootstrap.data.directory, files: [] },
  };
  return {
    refreshState: async () => data,
    changeDir: async () => data,
    listDirectory: async () => data,
    listAllDirectoryEntries: async (at) => {
      if (normalizeApiVirtualPath(at) === userRoot) {
        return [{ name: DRIVE_TRASH_DIR_NAME, path: trashPath, type: "dir" }];
      }
      return [];
    },
    search: async () => [],
    createFolder: async () => data,
    createFile: async () => data,
    renameItem,
    deleteItems: async () => data,
    downloadFile: async () => undefined,
    readFileBlob: async () => new Blob(),
    checkUploadReady: async () => undefined,
    listStars: async () => [],
    listEntriesByPaths: async () => [],
    setStar: async () => undefined,
    uploadFiles: async () => data,
  };
}

function DriveTrashConfirmHarness({
  renameItem,
}: {
  renameItem: DriveAPIOperations["renameItem"];
}) {
  const [operations] = useState(() => createDriveTrashStoryOperations(renameItem));
  const controller = useDriveModalStoryController("deleteTrash", operations);
  const shareDialog = useDriveShareDialog({});
  return (
    <DriveStoryScope>
      <DriveWorkspaceModals controller={controller} shareDialog={shareDialog} />
    </DriveStoryScope>
  );
}

const meta = {
  title: "Features/Drive/Dialogs/TrashConfirm",
  component: DriveTrashConfirmHarness,
} satisfies Meta<typeof DriveTrashConfirmHarness>;

export default meta;
type Story = StoryObj<typeof DriveTrashConfirmHarness>;

export const ConfirmMoveToTrash: Story = {
  tags: ["vitest-ci"],
  args: { renameItem: fn(async () => createDriveAppBootstrap().data) },
  play: async ({ args }) => {
    const body = within(document.body);
    const dialog = await body.findByRole("alertdialog", { name: "Move to Trash?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Move to Trash" }));
    await waitFor(() =>
      expect(body.queryByRole("alertdialog", { name: "Move to Trash?" })).not.toBeInTheDocument(),
    );
    const { from, destination, to } = trashRenameExpectation();
    await waitFor(() =>
      expect(args.renameItem).toHaveBeenCalledWith(
        expect.objectContaining({ from, destination, to }),
        expect.anything(),
      ),
    );
  },
};

export const CancelMoveToTrash: Story = {
  tags: ["vitest-ci"],
  args: { renameItem: fn(async () => createDriveAppBootstrap().data) },
  play: async ({ args }) => {
    const body = within(document.body);
    const dialog = await body.findByRole("alertdialog", { name: "Move to Trash?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(body.queryByRole("alertdialog", { name: "Move to Trash?" })).not.toBeInTheDocument(),
    );
    expect(args.renameItem).not.toHaveBeenCalled();
  },
};
