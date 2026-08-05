import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, within } from "storybook/test";
import {
  createDriveAppBootstrap,
  createMockDriveShareOperations,
} from "@/lib/api/mock/drive-bootstrap";
import { DriveAccessPane } from "@/drive-core/src/drive-access-pane";
import { DriveStoryScope } from "@/drive-core/stories/drive-story-scope";

function DriveAccessPaneHarness() {
  const bootstrap = createDriveAppBootstrap();

  return (
    <DriveStoryScope className="flex h-dvh flex-col">
      <DriveAccessPane
        shareOperations={createMockDriveShareOperations()}
        username={bootstrap.data.user.username}
        sidebarGroupPaths={["Groups/engineering"]}
        groupRootNames={new Set(["engineering"])}
        view={{ type: "access", scopePath: "My Drive/Projects/report.md" }}
        sidebarOpen
        onToggleSidebar={() => {}}
      />
    </DriveStoryScope>
  );
}

const meta = {
  title: "Apps/Drive/Panes/DriveAccessPane",
  component: DriveAccessPaneHarness,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof DriveAccessPaneHarness>;

export default meta;
type Story = StoryObj<typeof DriveAccessPaneHarness>;

export const Default: Story = {
  tags: ["vitest-ci"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Access" })).toBeInTheDocument();
    await expect(canvas.getAllByText(/Engineering/i).length).toBeGreaterThan(0);
    await userEvent.click(canvas.getByRole("button", { name: /alice/i }));
    await expect(await screen.findByRole("heading", { name: "alice" })).toBeInTheDocument();
  },
};
