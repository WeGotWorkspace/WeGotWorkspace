import { useEffect, useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";
import { driveLabels } from "@/drive-core/src/drive-labels";
import { useDriveUploadChooseFolder } from "@/drive-core/src/drive-upload-choose-folder";
import { driveFilesFromUploadQueue } from "@/drive-core/src/drive-upload-files";
import {
  buildDriveUploadQueueModel,
  DriveUploadQueueProvider,
  type DriveUploadQueueActions,
} from "@/drive-core/src/drive-upload-queue";
import {
  DRIVE_UPLOAD_ISSUE_STORY_CASES,
  driveUploadStoryItemId,
  driveUploadStorySnapshot,
  type DriveUploadStoryCase,
} from "@/drive-core/src/drive-upload-story-fixtures";
import { DriveUploadsPane } from "@/drive-core/src/drive-uploads-pane";
import { useDriveSidebarModel } from "@/drive-core/src/use-drive-sidebar-model";
import { useDrivePaneStoryController } from "@/drive-core/stories/drive-pane-stories.harness";
import { withDarkTheme } from "@/drive-core/stories/drive-story-dark-theme";
import { STORY_NOOP } from "@/drive-core/stories/drive-story-shared";
import { DriveStoryScope } from "@/drive-core/stories/drive-story-scope";
import type { DriveUploadQueueState } from "@/lib/offline/drive/upload/drive-upload-subscription";
import { SidebarSection } from "@/sidebar-section/src/sidebar-section";

/**
 * Upload pause and error states (#1522): the Uploads view while the server
 * is full, the files that need their own way out (folder gone, no access,
 * no https, signed out), the paused sidebar badge, and *Choose another
 * folder*. The sign-out warning lives with the logout screen.
 */
const meta = {
  title: "Features/Drive/UploadIssues",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj;

const SERVER_FULL_CASES: readonly DriveUploadStoryCase[] = [
  "serverFull",
  "waiting",
  "deviceFallback",
];

function UploadsHarness({
  cases,
  state,
  actions,
}: {
  cases: readonly DriveUploadStoryCase[];
  state: DriveUploadQueueState;
  actions: DriveUploadQueueActions;
}) {
  const snapshot = useMemo(() => driveUploadStorySnapshot({ cases, state }), [cases, state]);
  const model = useMemo(() => buildDriveUploadQueueModel(snapshot, actions), [actions, snapshot]);
  return (
    <DriveStoryScope className="flex min-h-dvh flex-col bg-background text-foreground">
      <DriveUploadQueueProvider value={model}>
        <DriveUploadsPane
          files={driveFilesFromUploadQueue(snapshot, "demo.user")}
          searchActive={false}
          onOpenFolder={STORY_NOOP}
        />
      </DriveUploadQueueProvider>
    </DriveStoryScope>
  );
}

function actionsFor(args: Record<string, unknown>): DriveUploadQueueActions {
  return {
    retry: args.retry as DriveUploadQueueActions["retry"],
    remove: args.remove as DriveUploadQueueActions["remove"],
    retryAllFailed: STORY_NOOP,
    resume: args.resume as DriveUploadQueueActions["resume"],
    chooseFolder: args.chooseFolder as DriveUploadQueueActions["chooseFolder"],
  };
}

const serverFull: Story = {
  args: { retry: fn(), remove: fn(), resume: fn(), chooseFolder: fn() },
  render: (args) => (
    <UploadsHarness
      cases={SERVER_FULL_CASES}
      state="paused_server_full"
      actions={actionsFor(args)}
    />
  ),
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByText("Uploads are paused: the server is full"),
    ).toBeInTheDocument();
    await expect(canvas.getByText(/emptying the trash helps/)).toBeInTheDocument();
    await expect(canvas.getAllByText(/^Waiting for space on the server/).length).toBe(2);
    await userEvent.click(canvas.getByRole("button", { name: "Retry" }));
    await expect(args.resume).toHaveBeenCalled();
  },
};

export const ServerFull: Story = {
  ...serverFull,
  name: "Uploads view: paused, server full",
  tags: ["vitest-ci"],
};

export const ServerFullDark: Story = {
  ...serverFull,
  name: "Uploads view: paused, server full (dark)",
  tags: ["vitest-ci"],
  decorators: [withDarkTheme],
};

const problems: Story = {
  args: { retry: fn(), remove: fn(), resume: fn(), chooseFolder: fn() },
  render: (args) => (
    <UploadsHarness
      cases={DRIVE_UPLOAD_ISSUE_STORY_CASES}
      state="idle"
      actions={actionsFor(args)}
    />
  ),
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    // Folder gone: choose another folder or remove.
    await expect(await canvas.findByText("The folder no longer exists")).toBeInTheDocument();
    await userEvent.click(
      canvas.getByRole("button", { name: "Choose another folder: Minutes.docx" }),
    );
    await expect(args.chooseFolder).toHaveBeenCalledWith(driveUploadStoryItemId("targetMissing"));
    // No access: explained, no sign-in, another folder offered.
    await expect(canvas.getByText(/Ask the owner to share the folder/)).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Choose another folder: Floor plan.pdf" }),
    ).toBeInTheDocument();
    // No https: only Remove, and the way to Admin for an administrator.
    await expect(canvas.getByText(/Ask your administrator to set up https/)).toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: "Retry Backup.tar" })).toBeNull();
    await expect(canvas.getByRole("button", { name: "Remove Backup.tar" })).toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: "Open Admin" })).toHaveAttribute(
      "href",
      "/admin",
    );
    // Signed out: Retry says it goes through sign-in.
    await expect(canvas.getByText(/Retry takes you to sign in/)).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Retry Logo.svg" })).toBeInTheDocument();
  },
};

export const Problems: Story = {
  ...problems,
  name: "Uploads view: folder gone, no access, no https, signed out",
  tags: ["vitest-ci"],
};

export const ProblemsDark: Story = {
  ...problems,
  name: "Uploads view: folder gone, no access, no https, signed out (dark)",
  tags: ["vitest-ci"],
  decorators: [withDarkTheme],
};

function SidebarHarness() {
  const { primarySidebarItems } = useDriveSidebarModel({
    labels: driveLabels,
    view: { type: "folder", path: "My Drive" },
    uploads: { count: 3, failed: 0, paused: true },
    sidebarGroupRoots: [],
    selectView: STORY_NOOP,
    sidebarDropZoneProps: () => ({}),
    commitMoveToFolder: STORY_NOOP,
  });
  return (
    <DriveStoryScope className="min-h-dvh bg-background p-6 text-foreground">
      <nav aria-label="Drive" className="w-64">
        <SidebarSection items={primarySidebarItems} />
      </nav>
    </DriveStoryScope>
  );
}

const sidebarPaused: Story = {
  render: () => <SidebarHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByText("3 files, paused, the server is full"),
    ).toBeInTheDocument();
  },
};

export const SidebarPaused: Story = {
  ...sidebarPaused,
  name: "Sidebar: Uploads paused, server full",
  tags: ["vitest-ci"],
};

export const SidebarPausedDark: Story = {
  ...sidebarPaused,
  name: "Sidebar: Uploads paused, server full (dark)",
  tags: ["vitest-ci"],
  decorators: [withDarkTheme],
};

function ChooseFolderHarness({
  retarget,
}: {
  retarget: (id: string, cwd: string) => Promise<boolean>;
}) {
  const controller = useDrivePaneStoryController();
  const snapshot = useMemo(
    () => driveUploadStorySnapshot({ cases: ["targetMissing"], state: "idle" }),
    [],
  );
  const { choose, dialog } = useDriveUploadChooseFolder(
    controller,
    snapshot,
    STORY_NOOP,
    STORY_NOOP,
    retarget,
  );
  useEffect(() => choose?.(driveUploadStoryItemId("targetMissing")), [choose]);
  return <DriveStoryScope className="min-h-dvh bg-background">{dialog}</DriveStoryScope>;
}

const chooseFolder: Story = {
  args: { retarget: fn(async () => true) },
  render: (args) => (
    <ChooseFolderHarness
      retarget={args.retarget as (id: string, cwd: string) => Promise<boolean>}
    />
  ),
  play: async ({ args }) => {
    const dialog = await screen.findByRole("dialog", { name: "Choose a folder for Minutes.docx" });
    const body = within(dialog);
    await expect(body.getByText("The file uploads to the folder you choose.")).toBeInTheDocument();
    await expect(body.getByRole("button", { name: "Upload here" })).toBeInTheDocument();
    await userEvent.click(body.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await expect(args.retarget).not.toHaveBeenCalled();
  },
};

export const ChooseFolder: Story = {
  ...chooseFolder,
  name: "Choose another folder",
  tags: ["vitest-ci"],
};

export const ChooseFolderDark: Story = {
  ...chooseFolder,
  name: "Choose another folder (dark)",
  tags: ["vitest-ci"],
  decorators: [withDarkTheme],
};
