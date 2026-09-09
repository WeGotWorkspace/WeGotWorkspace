import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { STORY_MCP_ENDPOINT_URL } from "@/settings-core/src/mcp-endpoint";
import { AdminMcpPane } from "@/admin-core/src/admin-mcp-pane";
import { useAdminPaneStoryController } from "@/admin-core/stories/admin-pane-stories.harness";
import { AdminStoryScope } from "@/admin-core/stories/admin-story-scope";
import { shareLabels } from "@/share-ui/share-labels";

const ENABLED_OVERRIDE = { mcp: { enabled: true } };

function McpPaneHarness({ enabled = false }: { enabled?: boolean }) {
  const controller = useAdminPaneStoryController(enabled ? ENABLED_OVERRIDE : undefined);
  return (
    <AdminStoryScope>
      <AdminMcpPane controller={controller} mcpEndpointUrl={STORY_MCP_ENDPOINT_URL} />
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

export const Enabled: Story = {
  render: () => <McpPaneHarness enabled />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const url = canvas.getByRole("textbox", { name: "Connection URL" });
    await expect(url).toHaveValue(STORY_MCP_ENDPOINT_URL);
    await expect(url).toHaveAttribute("readonly");
    await expect(canvas.getByRole("button", { name: shareLabels.copyLink })).toBeInTheDocument();
  },
};

export const ConfirmDisable: Story = {
  render: () => <McpPaneHarness enabled />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      canvas.getByRole("switch", { name: "Allow connected assistants enabled" }),
    );
    const dialog = await body.findByRole("alertdialog");
    await expect(dialog).toHaveTextContent("Turn off connected assistants?");
    await expect(dialog).toHaveTextContent("People will need to connect again");
    await expect(
      canvas.getByRole("switch", {
        name: "Allow connected assistants enabled",
        hidden: true,
      }),
    ).toHaveAttribute("aria-checked", "true");
  },
};
