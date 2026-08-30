import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
import { expect, userEvent, within } from "storybook/test";
import { CollectionListWorkspace } from "@/collection-layout/src/collection-layout";
import { ContactsListPanel } from "@/contacts-core/src/contacts-list-panel";
import { useSyncRetryToast } from "@/hooks/use-sync-retry-toast";
import { contactsGroupViewKey } from "@/contacts-core/src/contacts-group-utils";
import { useContactsPaneStoryController } from "./contacts-pane-stories.harness";
import { ContactsStoryScope } from "./contacts-story-scope";

const storyChrome = {
  sidebarOpen: true,
  toggleSidebar: () => {},
} as const;

export type ContactsListPanePreset = "default" | "empty" | "loading" | "inGroup";

function ContactsListPaneHarness({
  preset = "default",
  pendingCardIds,
  failedSyncCount,
}: {
  preset?: ContactsListPanePreset;
  pendingCardIds?: string[];
  failedSyncCount?: number;
}) {
  const controller = useContactsPaneStoryController(
    preset === "empty"
      ? { cardsOverride: [] }
      : preset === "loading"
        ? { listLoading: true }
        : undefined,
  );

  useSyncRetryToast({
    active: (failedSyncCount ?? 0) > 0,
    title: controller.L.syncFailedTitle,
    message: controller.L.syncFailedMessage,
    retryLabel: controller.L.retrySync,
    onRetry: () => {},
  });

  useEffect(() => {
    if (preset === "inGroup") {
      controller.selectView(contactsGroupViewKey("card-group-friends"));
    }
    // Storybook: apply group filter when preset changes, not on every controller churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [preset]);

  const listProps = ContactsListPanel({
    L: controller.L,
    sidebarOpen: storyChrome.sidebarOpen,
    onToggleSidebar: storyChrome.toggleSidebar,
    viewLabel: controller.viewLabel,
    view: controller.view,
    selectedGroupId: controller.selectedGroup?.id ?? null,
    canRenameGroup: controller.canRenameGroup,
    openGroupRenameDialog: (groupId, name) => controller.setGroupRenameDialog({ groupId, name }),
    canDeleteGroup: controller.canDeleteGroup,
    onDeleteGroup: controller.openDeleteGroupConfirm,
    selectedIds: controller.selectedIds,
    selectionMode: controller.selectionMode || controller.selectedIds.length > 1,
    listLoading: controller.listLoading,
    visibleCards: controller.visibleCards,
    searchQuery: controller.searchQuery,
    setSearchQuery: controller.setSearchQuery,
    searchInputRef: controller.searchInputRef,
    isTouch: controller.isTouch,
    activeId: controller.activeId,
    isItemDragging: controller.isItemDragging,
    handleSelect: controller.handleSelect,
    enterSelectionFor: controller.enterSelectionFor,
    itemDragHandlers: controller.itemDragHandlers,
    onSwipeDelete: (id) => controller.openDeleteConfirm([id]),
    onSwipeRemoveFromGroup: (id) => controller.removeFromGroup([id]),
    selectionBar: controller.selectionBar,
    onRefreshList: () => {},
    pendingCardIds: pendingCardIds ? new Set(pendingCardIds) : undefined,
  });

  return (
    <ContactsStoryScope variant="list-column">
      <CollectionListWorkspace {...listProps} />
      {controller.confirmDialog}
    </ContactsStoryScope>
  );
}

const meta = {
  title: "Apps/Contacts/Panes/List",
  component: ContactsListPaneHarness,
  parameters: {
    layout: "fullscreen",
  },
  argTypes: {
    preset: {
      control: "select",
      options: ["default", "empty", "loading", "inGroup"],
    },
  },
} satisfies Meta<typeof ContactsListPaneHarness>;

export default meta;
type Story = StoryObj<typeof ContactsListPaneHarness>;

export const Default: Story = {
  tags: ["vitest-ci"],
  args: { preset: "default" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { level: 3, name: "Jane Doe" })).toBeInTheDocument();
    await expect(canvas.getByRole("heading", { level: 3, name: "Acme Corp" })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Refresh contacts" })).toBeInTheDocument();
    await expect(canvas.queryByText("info@acme.com")).not.toBeInTheDocument();
    const input = canvas.getByPlaceholderText("Search contacts...");
    await userEvent.type(input, "joe@");
    await expect(input).toHaveValue("joe@");
  },
};

export const PendingSync: Story = {
  tags: ["vitest-ci"],
  args: { preset: "default", pendingCardIds: ["card-jane"] },
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
    await expect(body.getByText("Some changes couldn’t sync")).toBeInTheDocument();
    await expect(body.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  },
};

export const Empty: Story = {
  args: { preset: "empty" },
};

export const Loading: Story = {
  args: { preset: "loading" },
};

export const ActiveGroup: Story = {
  tags: ["vitest-ci"],
  args: { preset: "inGroup" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Friends")).toBeInTheDocument();
    await expect(canvas.getByText("2 Contacts")).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Rename group" })).toBeInTheDocument();
    await expect(canvas.getByRole("heading", { level: 3, name: "Jane Doe" })).toBeInTheDocument();
    await expect(
      canvas.getByRole("heading", { level: 3, name: "Joe Example" }),
    ).toBeInTheDocument();
  },
};
