import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import {
  DriveUploadBatchDialog,
  type DriveUploadBatchRequest,
} from "@/drive-core/src/drive-upload-batch-dialog";
import { DriveStoryScope } from "@/drive-core/stories/drive-story-scope";
import { withDarkTheme } from "@/drive-core/stories/drive-story-dark-theme";
import type { DriveUploadBatchQuestions } from "@/lib/offline/drive/upload/drive-upload-batch-questions";

const MB = 1024 * 1024;

const SPACE: NonNullable<DriveUploadBatchQuestions["space"]> = {
  status: "does_not_fit",
  quotaId: "dq-root",
  batchBytes: 1400 * MB,
  queuedBytes: 0,
  neededBytes: 1400 * MB,
  freeBytes: 800 * MB,
  measuredAt: Date.UTC(2026, 10, 2, 9, 30),
  fresh: true,
};

const CONFLICTS: NonNullable<DriveUploadBatchQuestions["conflicts"]> = {
  conflicts: [
    "report.pdf",
    "budget.xlsx",
    "photo-001.jpg",
    "photo-002.jpg",
    "photo-003.jpg",
    "photo-004.jpg",
    "notes.txt",
  ].map((name, index) => ({
    itemId: `i${index}`,
    name,
    existing: { nodeId: `n${index}`, blobId: `b${index}`, hashPending: false },
  })),
  choices: ["replace", "keep_both", "skip"],
  replaceTargets: {},
};

const KEEP_OFFLINE: NonNullable<DriveUploadBatchQuestions["keepOffline"]> = {
  limitBytes: 8 * MB,
  files: [
    { itemId: "v1", name: "holiday.mov", size: 420 * MB },
    { itemId: "v2", name: "backup.zip", size: 96 * MB },
  ],
};

const NONE: DriveUploadBatchQuestions = { space: null, conflicts: null, keepOffline: null };

function requestFor(questions: Partial<DriveUploadBatchQuestions>): DriveUploadBatchRequest {
  return {
    batchId: "story-batch",
    itemIds: Array.from({ length: 12 }, (_, index) => `item-${index}`),
    questions: { ...NONE, ...questions },
  };
}

const meta = {
  title: "Features/Drive/Dialogs/UploadBatch",
  component: DriveUploadBatchDialog,
  tags: ["vitest-ci"],
  decorators: [
    (Story) => (
      <DriveStoryScope>
        <Story />
      </DriveStoryScope>
    ),
  ],
  args: {
    request: requestFor({ space: SPACE, conflicts: CONFLICTS, keepOffline: KEEP_OFFLINE }),
    onCancel: fn(),
    onUpload: fn(),
  },
  argTypes: { request: { control: "object" } },
} satisfies Meta<typeof DriveUploadBatchDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

async function dialogNamed(name: string) {
  return within(document.body).findByRole("dialog", { name });
}

export const AllThreeSteps: Story = {
  play: async ({ args }) => {
    const space = await dialogNamed("Not enough space on the server");
    await expect(
      within(space).getByText("These 12 files need 1.4 GB; the server has 800 MB free."),
    ).toBeInTheDocument();
    await userEvent.click(within(space).getByRole("button", { name: "Add anyway" }));
    const conflicts = await dialogNamed("Some names already exist");
    await expect(within(conflicts).getByText("and 2 files more")).toBeInTheDocument();
    await userEvent.click(within(conflicts).getByRole("radio", { name: /Skip/ }));
    await userEvent.click(within(conflicts).getByRole("button", { name: "Next" }));
    const keep = await dialogNamed("Keep these files on this device?");
    await userEvent.click(within(keep).getByRole("button", { name: "Upload" }));
    await expect(args.onUpload).toHaveBeenCalledWith("story-batch", {
      keepOffline: "remove",
      conflict: "skip",
    });
  },
};

export const AllThreeStepsDark: Story = {
  name: "All three steps (dark)",
  decorators: [withDarkTheme],
  play: async () => {
    await dialogNamed("Not enough space on the server");
  },
};

export const SpaceOnly: Story = {
  args: { request: requestFor({ space: SPACE }) },
  play: async () => {
    const dialog = await dialogNamed("Not enough space on the server");
    await expect(within(dialog).queryByRole("list", { name: "Upload steps" })).toBeNull();
    await expect(within(dialog).getByRole("button", { name: "Add anyway" })).toBeInTheDocument();
  },
};

export const SpaceOfflineOutOfDate: Story = {
  args: {
    request: requestFor({
      space: { ...SPACE, fresh: false, queuedBytes: 200 * MB, neededBytes: 1600 * MB },
    }),
  },
  play: async () => {
    const dialog = await dialogNamed("Not enough space on the server");
    await expect(within(dialog).getByText(/It may be out of date/)).toBeInTheDocument();
    await expect(
      within(dialog).getByText(/together with the uploads already waiting/),
    ).toBeInTheDocument();
  },
};

export const ConflictsOnly: Story = {
  args: { request: requestFor({ conflicts: CONFLICTS }) },
  play: async () => {
    const dialog = await dialogNamed("Some names already exist");
    await expect(within(dialog).getByRole("radio", { name: /Keep both/ })).toBeChecked();
  },
};

export const ConflictsWithoutReplace: Story = {
  name: "Conflicts without Replace (no version check)",
  args: {
    request: requestFor({
      conflicts: {
        ...CONFLICTS,
        conflicts: CONFLICTS.conflicts.slice(0, 1),
        choices: ["keep_both", "skip"],
      },
    }),
  },
  play: async () => {
    const dialog = await dialogNamed("A file with this name already exists");
    await expect(within(dialog).queryByRole("radio", { name: /Replace/ })).toBeNull();
  },
};

export const KeepOfflineOnly: Story = {
  args: { request: requestFor({ keepOffline: KEEP_OFFLINE }) },
  play: async () => {
    const dialog = await dialogNamed("Keep these files on this device?");
    await expect(within(dialog).getByText(/larger than 8.0 MB/)).toBeInTheDocument();
    await expect(
      within(dialog).getByRole("radio", { name: /Remove from this device/ }),
    ).toBeChecked();
  },
};

export const KeepOfflineSyncOff: Story = {
  name: "Keep offline (offline files switched off)",
  args: { request: requestFor({ keepOffline: { ...KEEP_OFFLINE, limitBytes: null } }) },
  play: async () => {
    const dialog = await dialogNamed("Keep these files on this device?");
    await expect(within(dialog).getByText(/is switched off on this device/)).toBeInTheDocument();
  },
};

export const SpaceAndConflicts: Story = {
  args: { request: requestFor({ space: SPACE, conflicts: CONFLICTS }) },
  play: async () => {
    const dialog = await dialogNamed("Not enough space on the server");
    await expect(
      within(within(dialog).getByRole("list", { name: "Upload steps" })).getAllByRole("listitem"),
    ).toHaveLength(2);
  },
};

export const SpaceAndKeepOffline: Story = {
  args: { request: requestFor({ space: SPACE, keepOffline: KEEP_OFFLINE }) },
  play: async () => {
    await dialogNamed("Not enough space on the server");
  },
};

export const ConflictsAndKeepOffline: Story = {
  args: { request: requestFor({ conflicts: CONFLICTS, keepOffline: KEEP_OFFLINE }) },
  play: async () => {
    await dialogNamed("Some names already exist");
  },
};

export const ConflictsAndKeepOfflineDark: Story = {
  name: "Conflicts and keep offline (dark)",
  decorators: [withDarkTheme],
  args: { request: requestFor({ conflicts: CONFLICTS, keepOffline: KEEP_OFFLINE }) },
  play: async () => {
    await dialogNamed("Some names already exist");
  },
};

export const CancelDropsTheBatch: Story = {
  args: { request: requestFor({ keepOffline: KEEP_OFFLINE }) },
  play: async ({ args }) => {
    const dialog = await dialogNamed("Keep these files on this device?");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await expect(args.onCancel).toHaveBeenCalledWith("story-batch");
    await expect(args.onUpload).not.toHaveBeenCalled();
  },
};
