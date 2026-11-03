import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { MeetGuestChannelFrame } from "@/meet-core/src/meet-guest-channel";
import { WorkspaceApp } from "@/workspace-app/src/workspace-app";
import {
  WorkspaceAppLayout,
  WorkspaceSidebarToggle,
} from "@/workspace-shell/src/workspace-app-layout";
import "@/workspace-shell/src/workspace-color.css";
import "@/meet-core/src/meet-workspace.css";
import {
  HOME_INDICATOR_INSET_PX,
  STATUS_BAR_INSET_PX,
  offsetFromStoryTop,
  withStatusBarInset,
} from "@/workspace-shell/stories/status-bar-inset-story-shared";

async function expectColumnInset(canvasElement: HTMLElement, selector: string) {
  const column = canvasElement.querySelector(selector);
  await expect(column).toBeTruthy();
  await expect(getComputedStyle(column!).paddingTop).toBe(`${STATUS_BAR_INSET_PX}px`);
  await expect(getComputedStyle(column!).paddingBottom).toBe(`${HOME_INDICATOR_INSET_PX}px`);
}

async function expectToggleBelowStatusBar(canvasElement: HTMLElement) {
  const toggle = within(canvasElement).getByRole("button", { name: /show sidebar/i });
  await expect(offsetFromStoryTop(canvasElement, toggle)).toBeGreaterThanOrEqual(
    STATUS_BAR_INSET_PX,
  );
}

function OwnHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3 p-4">
      <WorkspaceSidebarToggle open={false} onToggle={() => {}} />
      <h2 className="text-sm font-medium">{title}</h2>
    </div>
  );
}

/** #1851: columns that draw their own header must still clear the iPhone status bar. */
const meta: Meta = {
  title: "Layout/Workspace Shell/Status bar inset",
  tags: ["vitest-ci"],
  decorators: [withStatusBarInset],
  parameters: {
    layout: "fullscreen",
  },
  globals: {
    viewport: { value: "mobile1", isRotated: false },
  },
};

export default meta;
type Story = StoryObj;

/** Split main without the shared `mainHeader` (Docs list): the main still pads the status bar. */
export const SplitWithOwnHeader: Story = {
  render: () => (
    <WorkspaceAppLayout
      sidebar={null}
      main={
        <>
          <OwnHeader title="Documents" />
          <p className="px-4">Roadmap 2026.md</p>
        </>
      }
    />
  ),
  play: async ({ canvasElement }) => {
    await expectColumnInset(canvasElement, ".workspace-app-layout__main");
    await expectToggleBelowStatusBar(canvasElement);
  },
};

/** List + detail collection (Notes, Contacts): both columns pad the status bar. */
export const CollectionListAndDetail: Story = {
  render: () => (
    <WorkspaceApp
      workspaceRoot={{ className: "notes-workspace" }}
      sidebar={() => null}
      list={() => ({
        header: <OwnHeader title="All items" />,
        listContent: <p className="p-4">Shopping list</p>,
        hasItems: true,
        emptyLabel: "No items",
      })}
      detail={() => <p className="p-4">Milk, eggs</p>}
    />
  ),
  play: async ({ canvasElement }) => {
    await expectColumnInset(canvasElement, ".collection-list-pane");
    await expectColumnInset(canvasElement, ".workspace-detail-pane");
    await expectToggleBelowStatusBar(canvasElement);
  },
};

/** Meet guest lobby pads itself, so the shared main inset stays off (no double gap). */
export const MeetGuestLobbyPadsItself: Story = {
  render: () => (
    <MeetGuestChannelFrame>
      <p>Waiting for the host</p>
    </MeetGuestChannelFrame>
  ),
  play: async ({ canvasElement }) => {
    const main = canvasElement.querySelector(".workspace-app-layout__main");
    await expect(main).toBeTruthy();
    await expect(getComputedStyle(main!).paddingTop).toBe("0px");
  },
};
