import { useEffect, useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { DriveMainPane } from "@/drive-core/src/drive-main-pane";
import type { DriveFile } from "@/drive-core/src/drive-models";
import { DriveNewMenu } from "@/drive-core/src/drive-new-menu";
import { driveLabels } from "@/drive-core/src/drive-labels";
import {
  buildDriveUploadQueueModel,
  DriveUploadQueueProvider,
} from "@/drive-core/src/drive-upload-queue";
import { driveUploadStorySnapshot } from "@/drive-core/src/drive-upload-story-fixtures";
import { getDriveStoryFilesInMyDrive } from "@/drive-core/stories/drive-pane-stories.fixtures";
import { useDrivePaneStoryController } from "@/drive-core/stories/drive-pane-stories.harness";
import { withDarkTheme } from "@/drive-core/stories/drive-story-dark-theme";
import { STORY_NOOP } from "@/drive-core/stories/drive-story-shared";
import { DriveStoryScope } from "@/drive-core/stories/drive-story-scope";
import type { DriveUploadFolderView } from "@/lib/offline/drive/upload/drive-upload-subscription";

/**
 * Folder upload (#1620): the folders of an upload as rows in the folder the
 * user is in. Each shows the progress of everything below it, the files that
 * failed, or why the folder itself could not be made. *Upload folder* in the
 * New menu starts it.
 */
const meta = {
  title: "Features/Drive/UploadFolders",
  parameters: { layout: "fullscreen" },
  tags: ["vitest-ci"],
} satisfies Meta;

export default meta;
type Story = StoryObj;

const MB = 1024 * 1024;

function folderView(
  id: string,
  name: string,
  progress: Partial<DriveUploadFolderView>,
): DriveUploadFolderView {
  return {
    id,
    batchId: "batch-plain",
    name,
    sourceName: name,
    status: "created",
    targetFolder: { kind: "server", id: "root" },
    subtreeBytes: 120 * MB,
    subtreeFiles: 24,
    bytesDone: 0,
    filesDone: 0,
    failedFiles: 0,
    canRetry: false,
    ...progress,
  };
}

const FOLDERS: DriveUploadFolderView[] = [
  folderView("folder-photos", "Photos", { bytesDone: 50 * MB, filesDone: 9, failedFiles: 2 }),
  folderView("folder-music", "Music", { status: "waiting" }),
  folderView("folder-old", "Old scans", {
    filesDone: 20,
    failedFiles: 4,
    bytesDone: 100 * MB,
    canRetry: true,
  }),
  folderView("folder-gone", "Taxes", {
    status: "failed",
    error: { code: "target_missing", message: "" },
    canRetry: true,
  }),
];

function placeholder(folder: DriveUploadFolderView): DriveFile {
  return {
    id: `My Drive/${folder.name}`,
    notebook: "",
    category: "Folder",
    date: "Today",
    title: folder.name,
    excerpt: "",
    body: [],
    tags: [],
    wordCount: 0,
    parent: "My Drive",
    kind: "folder",
    size: "",
    upload: { id: folder.id, status: folder.status === "failed" ? "failed" : "uploading" },
  };
}

function FoldersHarness({ viewMode }: { viewMode: "grid" | "list" }) {
  const model = useMemo(() => {
    const snapshot = { ...driveUploadStorySnapshot({ cases: [] }), folders: FOLDERS };
    return buildDriveUploadQueueModel(snapshot, { retry: STORY_NOOP, remove: STORY_NOOP });
  }, []);
  const files = useMemo(
    () => [...getDriveStoryFilesInMyDrive().slice(0, 2), ...FOLDERS.map(placeholder)],
    [],
  );
  const controller = useDrivePaneStoryController({ filesOverride: files });
  const { setViewMode } = controller;
  useEffect(() => setViewMode(viewMode), [setViewMode, viewMode]);
  const noneOffline = useMemo(() => new Set<string>(), []);
  return (
    <DriveStoryScope className="flex h-dvh flex-col">
      <DriveUploadQueueProvider value={model}>
        <DriveMainPane
          controller={controller}
          offlineEnabled
          offlineAvailableIds={noneOffline}
          onMakeOfflineAvailable={STORY_NOOP}
        />
      </DriveUploadQueueProvider>
    </DriveStoryScope>
  );
}

async function expectFolderStates(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  const status = (text: string) =>
    canvas.findByText(
      (_, element) =>
        Boolean(element?.classList.contains("drive-upload-status")) &&
        element?.textContent === text,
    );
  await expect(await status("Uploading · 42% · 2 files failed")).toBeInTheDocument();
  await expect(await status("Waiting to upload")).toBeInTheDocument();
  await expect(await status("Upload failed · 4 files failed")).toBeInTheDocument();
  await expect(await status("Upload failed · The folder no longer exists")).toBeInTheDocument();
}

export const FolderRowsList: Story = {
  name: "Folder rows (list)",
  render: () => <FoldersHarness viewMode="list" />,
  play: async ({ canvasElement }) => expectFolderStates(canvasElement),
};

export const FolderRowsListDark: Story = {
  name: "Folder rows (list, dark)",
  decorators: [withDarkTheme],
  render: () => <FoldersHarness viewMode="list" />,
  play: async ({ canvasElement }) => expectFolderStates(canvasElement),
};

export const FolderRowsGrid: Story = {
  name: "Folder rows (grid)",
  render: () => <FoldersHarness viewMode="grid" />,
};

export const NewMenuWithUploadFolder: Story = {
  name: "New menu: Upload folder",
  render: () => (
    <DriveStoryScope className="w-64 bg-background p-4 text-foreground">
      <DriveNewMenu
        labels={driveLabels}
        onCreateFolder={STORY_NOOP}
        onUploadFiles={STORY_NOOP}
        onUploadFolder={STORY_NOOP}
      />
    </DriveStoryScope>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: driveLabels.newButtonMenu }));
    const menu = await within(document.body).findByRole("menu");
    await expect(within(menu).getByRole("menuitem", { name: "Upload folder" })).toBeInTheDocument();
  },
};
