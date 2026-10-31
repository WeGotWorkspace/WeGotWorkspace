import { useEffect, useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { driveLabels } from "@/drive-core/src/drive-labels";
import type { ViewKey } from "@/drive-core/src/drive-models";
import { useDriveSidebarModel } from "@/drive-core/src/use-drive-sidebar-model";
import { SidebarSection } from "@/sidebar-section/src/sidebar-section";
import { DriveMainPane } from "@/drive-core/src/drive-main-pane";
import { driveFilesFromUploadQueue } from "@/drive-core/src/drive-upload-files";
import {
  buildDriveUploadQueueModel,
  driveUploadRowStateFor,
  DriveUploadQueueProvider,
  type DriveUploadQueueActions,
} from "@/drive-core/src/drive-upload-queue";
import { DriveUploadRingView } from "@/drive-core/src/drive-upload-ring";
import {
  driveUploadStoryPlaceholders,
  driveUploadStorySnapshot,
  type DriveUploadStoryCase,
} from "@/drive-core/src/drive-upload-story-fixtures";
import { DriveUploadsPane } from "@/drive-core/src/drive-uploads-pane";
import { getDriveStoryFilesInMyDrive } from "@/drive-core/stories/drive-pane-stories.fixtures";
import { useDrivePaneStoryController } from "@/drive-core/stories/drive-pane-stories.harness";
import { withDarkTheme } from "@/drive-core/stories/drive-story-dark-theme";
import { STORY_NOOP } from "@/drive-core/stories/drive-story-shared";
import { DriveStoryScope } from "@/drive-core/stories/drive-story-scope";
import type { DriveUploadQueueState } from "@/lib/offline/drive/upload/drive-upload-subscription";

/**
 * Per-file upload progress (#1502): the ring in the offline control's slot,
 * placeholder rows in list and grid, and the Uploads view. One file per
 * state: waiting, uploading (busy and with a percentage), finishing on the
 * server, waiting for an answer, failed, failed without a local copy, and the
 * device storage fallback.
 */
const meta = {
  title: "Features/Drive/UploadProgress",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj;

const STORY_ACTIONS: DriveUploadQueueActions = {
  retry: STORY_NOOP,
  remove: STORY_NOOP,
  retryAllFailed: STORY_NOOP,
};

const OFFLINE_CASES: readonly DriveUploadStoryCase[] = ["waiting", "deviceFallback", "failed"];

function useStoryModel(state: DriveUploadQueueState, cases?: readonly DriveUploadStoryCase[]) {
  return useMemo(() => {
    const snapshot = driveUploadStorySnapshot({ state, ...(cases ? { cases } : {}) });
    return { snapshot, model: buildDriveUploadQueueModel(snapshot, STORY_ACTIONS) };
  }, [cases, state]);
}

/** The offline control's slot on its own: one ring per state. */
function RingsHarness({ state = "running" }: { state?: DriveUploadQueueState }) {
  const { snapshot, model } = useStoryModel(
    state,
    state === "paused_offline" ? OFFLINE_CASES : undefined,
  );
  const files = driveUploadStoryPlaceholders(snapshot);
  return (
    <DriveStoryScope className="min-h-dvh bg-background p-6 text-foreground">
      <ul className="flex flex-col gap-2">
        {files.map((file) => {
          const rowState = driveUploadRowStateFor(file.upload!, model);
          return (
            <li key={file.id} className="flex items-center gap-3">
              <DriveUploadRingView fileName={file.title} state={rowState} />
              <span className="text-sm">{file.title}</span>
              <span className="drive-upload-status">{rowState.statusText}</span>
            </li>
          );
        })}
      </ul>
    </DriveStoryScope>
  );
}

/** `DriveMainPane` with `offlineEnabled`: placeholders between real files. */
function FolderHarness({
  viewMode,
  state = "running",
}: {
  viewMode: "grid" | "list";
  state?: DriveUploadQueueState;
}) {
  const { snapshot, model } = useStoryModel(
    state,
    state === "paused_offline" ? OFFLINE_CASES : undefined,
  );
  const files = useMemo(
    () => [
      ...getDriveStoryFilesInMyDrive().slice(0, 2),
      ...driveUploadStoryPlaceholders(snapshot, "My Drive"),
    ],
    [snapshot],
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

/** The Uploads view; `allDone` empties the queue after the first render. */
function UploadsViewHarness({ allDone = false }: { allDone?: boolean }) {
  const [snapshot, setSnapshot] = useState(() => driveUploadStorySnapshot());
  useEffect(() => {
    if (allDone) setSnapshot(driveUploadStorySnapshot({ cases: [], state: "idle" }));
  }, [allDone]);
  const model = useMemo(() => buildDriveUploadQueueModel(snapshot, STORY_ACTIONS), [snapshot]);
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

/** The Drive sidebar's primary items, with the Uploads entry and its badge. */
function SidebarHarness({
  uploads,
  view = { type: "folder", path: "My Drive" },
}: {
  uploads: { count: number; failed: number };
  view?: ViewKey;
}) {
  const { primarySidebarItems } = useDriveSidebarModel({
    labels: driveLabels,
    view,
    uploads,
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

async function expectRings(canvasElement: HTMLElement, count: number) {
  const canvas = within(canvasElement);
  const rings = await canvas.findAllByRole("progressbar");
  await expect(rings).toHaveLength(count);
  for (const ring of rings) {
    await expect(ring.getAttribute("aria-label")).toMatch(/^Upload of /);
    await expect(ring.getAttribute("aria-valuetext")).toBeTruthy();
  }
}

export const PinSlotRings: Story = {
  name: "Pin slot: every ring state",
  tags: ["vitest-ci"],
  render: () => <RingsHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expectRings(canvasElement, 6);
    await expect(
      canvas.getByRole("progressbar", { name: "Upload of Launch video.mp4" }),
    ).toHaveAttribute("aria-valuenow", "45");
    await expect(
      canvas.getByRole("progressbar", { name: "Upload of Archive 2025.zip" }),
    ).toHaveAttribute("aria-valuetext", "Finishing on the server");
    await expect(
      canvas.getByRole("img", { name: /Interview notes.txt: .*Add the file again/ }),
    ).toBeInTheDocument();
  },
};

export const PinSlotRingsDark: Story = {
  name: "Pin slot: every ring state (dark)",
  tags: ["vitest-ci"],
  decorators: [withDarkTheme],
  render: () => <RingsHarness />,
  play: async ({ canvasElement }) => expectRings(canvasElement, 6),
};

export const PinSlotRingsOffline: Story = {
  name: "Pin slot: waiting for a connection",
  tags: ["vitest-ci"],
  render: () => <RingsHarness state="paused_offline" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("progressbar", { name: "Upload of Quarterly report.pdf" }),
    ).toHaveAttribute("aria-valuetext", "Waiting for a connection");
  },
};

export const ListView: Story = {
  name: "List: placeholders in every state",
  tags: ["vitest-ci"],
  render: () => <FolderHarness viewMode="list" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("table")).toBeInTheDocument();
    await expectRings(canvasElement, 6);
    await expect(canvas.getByText(/Waiting for your answer/)).toBeInTheDocument();
    await expect(canvas.getByText(/Not saved on this device/)).toBeInTheDocument();
  },
};

export const ListViewDark: Story = {
  name: "List: placeholders in every state (dark)",
  tags: ["vitest-ci"],
  decorators: [withDarkTheme],
  render: () => <FolderHarness viewMode="list" />,
  play: async ({ canvasElement }) => expectRings(canvasElement, 6),
};

export const ListViewOffline: Story = {
  name: "List: waiting for a connection",
  tags: ["vitest-ci"],
  render: () => <FolderHarness viewMode="list" state="paused_offline" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect((await canvas.findAllByText(/Waiting for a connection/)).length).toBe(2);
  },
};

export const ListViewOfflineDark: Story = {
  name: "List: waiting for a connection (dark)",
  tags: ["vitest-ci"],
  decorators: [withDarkTheme],
  render: () => <FolderHarness viewMode="list" state="paused_offline" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect((await canvas.findAllByText(/Waiting for a connection/)).length).toBe(2);
  },
};

export const GridViewOffline: Story = {
  name: "Grid: waiting for a connection",
  tags: ["vitest-ci"],
  render: () => <FolderHarness viewMode="grid" state="paused_offline" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect((await canvas.findAllByText(/Waiting for a connection/)).length).toBe(2);
  },
};

export const GridViewOfflineDark: Story = {
  name: "Grid: waiting for a connection (dark)",
  tags: ["vitest-ci"],
  decorators: [withDarkTheme],
  render: () => <FolderHarness viewMode="grid" state="paused_offline" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect((await canvas.findAllByText(/Waiting for a connection/)).length).toBe(2);
  },
};

export const GridView: Story = {
  name: "Grid: placeholders in every state",
  tags: ["vitest-ci"],
  render: () => <FolderHarness viewMode="grid" />,
  play: async ({ canvasElement }) => {
    await expectRings(canvasElement, 6);
  },
};

export const GridViewDark: Story = {
  name: "Grid: placeholders in every state (dark)",
  tags: ["vitest-ci"],
  decorators: [withDarkTheme],
  render: () => <FolderHarness viewMode="grid" />,
  play: async ({ canvasElement }) => expectRings(canvasElement, 6),
};

export const UploadsView: Story = {
  name: "Uploads view",
  tags: ["vitest-ci"],
  render: () => <UploadsViewHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("8 files · 2 failed")).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Retry all failed" })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Retry Scan 0042.png" })).toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: "Retry Interview notes.txt" })).toBeNull();
  },
};

export const UploadsViewDark: Story = {
  name: "Uploads view (dark)",
  tags: ["vitest-ci"],
  decorators: [withDarkTheme],
  render: () => <UploadsViewHarness />,
  play: async ({ canvasElement }) => expectRings(canvasElement, 6),
};

export const UploadsAllDone: Story = {
  name: "Uploads view: all done",
  tags: ["vitest-ci"],
  render: () => <UploadsViewHarness allDone />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("All uploads are done")).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Go to Personal / Projects" }),
    ).toBeInTheDocument();
  },
};

export const UploadsAllDoneDark: Story = {
  name: "Uploads view: all done (dark)",
  tags: ["vitest-ci"],
  decorators: [withDarkTheme],
  render: () => <UploadsViewHarness allDone />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("All uploads are done")).toBeInTheDocument();
  },
};

export const SidebarUploadsCount: Story = {
  name: "Sidebar: Uploads count",
  tags: ["vitest-ci"],

  render: () => <SidebarHarness uploads={{ count: 3, failed: 0 }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("3 files")).toBeInTheDocument();
  },
};

export const SidebarUploadsFailed: Story = {
  name: "Sidebar: Uploads error badge",
  tags: ["vitest-ci"],

  render: () => <SidebarHarness uploads={{ count: 3, failed: 1 }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("3 files, 1 failed")).toBeInTheDocument();
  },
};

export const SidebarUploadsSelected: Story = {
  name: "Sidebar: Uploads selected",
  tags: ["vitest-ci"],

  render: () => <SidebarHarness uploads={{ count: 2, failed: 0 }} view={{ type: "uploads" }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("2 files")).toBeInTheDocument();
  },
};

export const SidebarUploadsCountDark: Story = {
  name: "Sidebar: Uploads count (dark)",
  tags: ["vitest-ci"],
  decorators: [withDarkTheme],
  render: () => <SidebarHarness uploads={{ count: 3, failed: 0 }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("3 files")).toBeInTheDocument();
  },
};

export const SidebarUploadsFailedDark: Story = {
  name: "Sidebar: Uploads error badge (dark)",
  tags: ["vitest-ci"],
  decorators: [withDarkTheme],
  render: () => <SidebarHarness uploads={{ count: 3, failed: 1 }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("3 files, 1 failed")).toBeInTheDocument();
  },
};

export const SidebarUploadsSelectedDark: Story = {
  name: "Sidebar: Uploads selected (dark)",
  tags: ["vitest-ci"],
  decorators: [withDarkTheme],
  render: () => <SidebarHarness uploads={{ count: 2, failed: 0 }} view={{ type: "uploads" }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("2 files")).toBeInTheDocument();
  },
};
