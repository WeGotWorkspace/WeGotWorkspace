import { useEffect } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { CollectionListWorkspace } from "@/collection-layout/src/collection-layout";
import { NotesListPanel } from "@/notes-core/src/notes-list-panel";
import { useSyncRetryToast } from "@/hooks/use-sync-retry-toast";
import { useNotesPaneStoryController } from "./notes-pane-stories.harness";
import { NotesStoryScope } from "./notes-story-scope";

const storyChrome = {
  sidebarOpen: true,
  toggleSidebar: () => {},
} as const;

export type NotesListPanePreset = "default" | "empty" | "loading" | "inNotebook";

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
    preset === "empty"
      ? { notesOverride: [] }
      : preset === "loading"
        ? { listLoading: true }
        : undefined,
  );

  const firstNotebook = controller.notes[0]?.notebook ?? "";

  useSyncRetryToast({
    active: (failedSyncCount ?? 0) > 0,
    title: controller.L.syncFailedTitle,
    message: controller.L.syncFailedMessage,
    retryLabel: controller.L.retrySync,
    onRetry: () => {},
  });

  useEffect(() => {
    if (preset === "inNotebook" && firstNotebook) {
      controller.selectView(`nb:${firstNotebook}`);
    }
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
    pendingNoteIds: pendingNoteIds ? new Set(pendingNoteIds) : undefined,
  });

  return (
    <NotesStoryScope variant="list-column">
      <CollectionListWorkspace {...listProps} />
      {controller.confirmDialog}
    </NotesStoryScope>
  );
}

const meta = {
  title: "Apps/Notes/Panes/List",
  component: NotesListPaneHarness,
  parameters: {
    layout: "fullscreen",
  },
  argTypes: {
    preset: {
      control: "select",
      options: ["default", "empty", "loading", "inNotebook"],
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
    await expect(canvas.getByText("3 Items")).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Refresh notes" })).toBeInTheDocument();
    await expect(canvas.getByText("architecture")).toBeInTheDocument();
    await expect(canvas.getByText("essay")).toBeInTheDocument();
    await expect(canvasElement.querySelector(".notes-notebook-color-icon")).toBeTruthy();
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
  play: async () => {
    const body = within(document.body);
    await expect(body.getByText("Some changes could not sync")).toBeInTheDocument();
    await expect(body.getByRole("button", { name: "Retry" })).toBeInTheDocument();
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
