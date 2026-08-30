import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { CollectionListWorkspace } from "@/collection-layout/src/collection-layout";
import { MailListPanel } from "@/mail-core/src/mail-list-panel";
import { useMailPaneStoryController } from "./mail-pane-stories.harness";
import { MailStoryScope } from "./mail-story-scope";

const storyChrome = {
  sidebarOpen: true,
  toggleSidebar: () => {},
} as const;

export type MailListPanePreset = "default" | "empty" | "loading";

function MailListPaneHarness({ preset = "default" }: { preset?: MailListPanePreset }) {
  const controller = useMailPaneStoryController(
    preset === "empty"
      ? { mailOverride: [] }
      : preset === "loading"
        ? { listLoading: true }
        : undefined,
  );

  const listProps = MailListPanel({
    L: controller.L,
    sidebarOpen: storyChrome.sidebarOpen,
    onToggleSidebar: storyChrome.toggleSidebar,
    viewLabel: controller.viewLabel,
    selectedIds: controller.selectedIds,
    selectionMode: controller.selectionMode || controller.selectedIds.length > 1,
    effectiveListLoading: controller.effectiveListLoading,
    visibleMail: controller.visibleMail,
    searchQuery: controller.searchQuery,
    setSearchQuery: controller.setSearchQuery,
    searchInputRef: controller.searchInputRef,
    inTrash: controller.inTrash,
    isTouch: controller.isTouch,
    starred: controller.starred,
    activeId: controller.activeId,
    isItemDragging: controller.isItemDragging,
    handleSelect: controller.handleSelect,
    handleDoubleClick: controller.handleMailItemDoubleClick,
    enterSelectionFor: controller.enterSelectionFor,
    itemDragHandlers: controller.itemDragHandlers,
    toggleStar: controller.toggleStar,
    moveOne: controller.moveOne,
    listEndRef: controller.listEndRef,
    isLoadingMore: controller.isLoadingMore,
    selectionBar: controller.selectionBar,
  });

  return (
    <MailStoryScope variant="list-column">
      <CollectionListWorkspace {...listProps} />
      {controller.confirmDialog}
    </MailStoryScope>
  );
}

const meta = {
  title: "Apps/Mail/Panes/List",
  component: MailListPaneHarness,
  parameters: {
    layout: "fullscreen",
  },
  argTypes: {
    preset: {
      control: "select",
      options: ["default", "empty", "loading"],
    },
  },
} satisfies Meta<typeof MailListPaneHarness>;

export default meta;
type Story = StoryObj<typeof MailListPaneHarness>;

export const Default: Story = {
  tags: ["vitest-ci"],
  args: { preset: "default" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/Revised proofs for the autumn issue/i)).toBeInTheDocument();
    const input = canvas.getByPlaceholderText("Search mail...");
    await userEvent.type(input, "newsletter");
    await expect(input).toHaveValue("newsletter");
  },
};

export const Empty: Story = {
  args: { preset: "empty" },
};

export const Loading: Story = {
  args: { preset: "loading" },
};
