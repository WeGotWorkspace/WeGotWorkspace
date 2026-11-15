import { useEffect } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { CollectionListWorkspace } from "@/collection-layout/src/collection-layout";
import { NotesListPanel } from "@/notes-core/src/notes-list-panel";
import { tagForNotesView } from "@/notes-core/src/use-notes-sidebar-model";
import { NoticeBar } from "@/notice-bar/src/notice-bar";
import { useSyncRetryNotice } from "@/notice-bar/src/use-sync-retry-notice";
import { useNotesPaneStoryController } from "./notes-pane-stories.harness";
import { NotesStoryScope } from "./notes-story-scope";

const storyChrome = {
  sidebarOpen: true,
  toggleSidebar: () => {},
} as const;

// Stable references: a fresh `[]` per render rebuilds the bootstrap data and loops.
const EMPTY_PRESET = { notesOverride: [] };
const LOADING_PRESET = { listLoading: true };

export type NotesListPanePreset = "default" | "empty" | "loading" | "inNotebook" | "inTag";

export function NotesListPaneHarness({
  preset = "default",
  pendingNoteIds,
  failedSyncCount,
}: {
  preset?: NotesListPanePreset;
  pendingNoteIds?: string[];
  failedSyncCount?: number;
}) {
  const controller = useNotesPaneStoryController(
    preset === "empty" ? EMPTY_PRESET : preset === "loading" ? LOADING_PRESET : undefined,
  );

  const firstNotebook = controller.notes[0]?.notebook ?? "";

  const syncNotice = useSyncRetryNotice({
    id: "sync:notes",
    active: (failedSyncCount ?? 0) > 0,
    title: controller.L.syncFailedNotice,
    retryLabel: controller.L.retrySync,
    onRetry: () => {},
  });

  useEffect(() => {
    if (preset === "inNotebook" && firstNotebook) {
      controller.selectView(`nb:${firstNotebook}`);
    }
    if (preset === "inTag") controller.selectView("tag:essay");
    // Storybook: apply notebook filter when preset/seed change, not on every controller churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [preset, firstNotebook]);

  const listProps = NotesListPanel({
    L: controller.L,
    sidebarOpen: storyChrome.sidebarOpen,
    onToggleSidebar: storyChrome.toggleSidebar,
    viewLabel: controller.viewLabel,
    selectedIds: controller.selectedIds,
    selectionMode: controller.selectionMode || controller.selectedIds.length > 1,
    listLoading: controller.listLoading,
    visibleNotes: controller.visibleNotes,
    searchQuery: controller.searchQuery,
    setSearchQuery: controller.setSearchQuery,
    searchInputRef: controller.searchInputRef,
    view: controller.view,
    isTouch: controller.isTouch,
    starred: controller.starred,
    archived: controller.archived,
    activeId: controller.activeId,
    isItemDragging: controller.isItemDragging,
    handleSelect: controller.handleSelect,
    enterSelectionFor: controller.enterSelectionFor,
    itemDragHandlers: controller.itemDragHandlers,
    openDeleteConfirmForArchive: controller.openDeleteConfirm,
    toggleStar: controller.toggleStar,
    toggleArchive: controller.toggleArchive,
    selectionBar: controller.selectionBar,
    onRefreshList: () => {},
    onEditTag: tagForNotesView(controller.view, controller.tags) ? () => {} : undefined,
    pendingNoteIds: pendingNoteIds ? new Set(pendingNoteIds) : undefined,
  });

  return (
    <NotesStoryScope variant="list-column">
      <CollectionListWorkspace
        {...listProps}
        listTop={<NoticeBar label={controller.L.noticeBarLabel} notices={[syncNotice]} />}
      />
      {controller.confirmDialog}
    </NotesStoryScope>
  );
}

const meta = {
  title: "Features/Notes/Panes/List",
  component: NotesListPaneHarness,
  parameters: {
    layout: "fullscreen",
  },
  argTypes: {
    preset: {
      control: "select",
      options: ["default", "empty", "loading", "inNotebook", "inTag"],
    },
  },
} satisfies Meta<typeof NotesListPaneHarness>;

export default meta;
type Story = StoryObj<typeof NotesListPaneHarness>;

export const Default: Story = {
  tags: ["vitest-ci"],
  args: { preset: "default" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: /Endless scroll/i })).toBeInTheDocument();
    await expect(canvas.getByLabelText("3 Items")).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Refresh notes" })).toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: "Edit tag" })).toBeNull();
    await expect(canvasElement.querySelector(".list-item__tags")).toBeNull();
    await expect(canvas.queryByText("architecture")).toBeNull();
    await expect(canvas.queryByText("essay")).toBeNull();
    // Suite list norm: title + date top right, a two-line preview, the notebook with its dot.
    const row = canvasElement.querySelector(".list-item__button") as HTMLElement;
    await expect(row.querySelector(".list-item__meta .collection-color-dot")).toBeTruthy();
    await expect(row.querySelector(".list-item__title-row .list-item__date")).toBeTruthy();
    await expect(row.querySelector(".list-item__body--preview")).toBeTruthy();
    await expect(canvasElement.querySelector(".collection-sidebar-row__dot")).toBeNull();
    const input = canvas.getByPlaceholderText("Search notes...");
    await userEvent.type(input, "Nordic");
    await expect(input).toHaveValue("Nordic");
  },
};

export const PendingSync: Story = {
  tags: ["vitest-ci"],
  args: { preset: "default", pendingNoteIds: ["1"] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("img", { name: "Pending sync" })).toBeInTheDocument();
  },
};

export const RetrySync: Story = {
  tags: ["vitest-ci"],
  args: { preset: "default", failedSyncCount: 2 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const bar = await canvas.findByRole("region", { name: "Needs your attention" });
    await expect(bar).toHaveTextContent(
      "Some changes could not sync. They are saved on this device.",
    );
    await expect(within(bar).getByRole("button", { name: "Retry" })).toBeEnabled();
  },
};

export const Empty: Story = {
  args: { preset: "empty" },
};

export const Loading: Story = {
  args: { preset: "loading" },
};

export const ActiveNotebook: Story = {
  tags: ["vitest-ci"],
  args: { preset: "inNotebook" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("button", { name: "Edit" })).toBeNull();
    await expect(canvas.queryByRole("button", { name: "Remove" })).toBeNull();
    await expect(canvas.queryByRole("button", { name: "Delete notebook" })).toBeNull();
  },
};

/** A tag filter adds "Edit tag" directly left of refresh (#1744). */
export const ActiveTag: Story = {
  tags: ["vitest-ci"],
  args: { preset: "inTag" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const edit = await canvas.findByRole("button", { name: "Edit tag" });
    const refresh = canvas.getByRole("button", { name: "Refresh notes" });
    await expect(edit.nextElementSibling).toBe(refresh);
  },
};
