import type { Meta, StoryObj } from "@storybook/react-vite";
import { AdminMcpPane } from "@/admin-core/src/admin-mcp-pane";
import { useAdminPaneStoryController } from "@/admin-core/stories/admin-pane-stories.harness";
import { AdminStoryScope } from "@/admin-core/stories/admin-story-scope";

function McpPaneHarness() {
  const controller = useAdminPaneStoryController();
  return (
    <AdminStoryScope>
      <AdminMcpPane controller={controller} />
    </AdminStoryScope>
  );
}

const meta = {
  title: "Apps/Admin/Panes/Connected assistants",
  component: AdminMcpPane,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof AdminMcpPane>;

export default meta;
type Story = StoryObj<typeof AdminMcpPane>;

export const Default: Story = {
  render: () => <McpPaneHarness />,
};
