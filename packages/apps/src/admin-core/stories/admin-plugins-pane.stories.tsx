import type { Meta, StoryObj } from "@storybook/react-vite";
import type { AdminStoryDataOverride } from "@/admin-core/stories/admin-pane-stories.harness";
import { AdminPluginsPane } from "@/admin-core/src/admin-plugins-pane";
import { useAdminPaneStoryController } from "@/admin-core/stories/admin-pane-stories.harness";
import { AdminStoryScope } from "@/admin-core/stories/admin-story-scope";

function PluginsPaneHarness({ dataOverride }: { dataOverride?: AdminStoryDataOverride }) {
  const controller = useAdminPaneStoryController(dataOverride);
  return (
    <AdminStoryScope>
      <AdminPluginsPane controller={controller} />
    </AdminStoryScope>
  );
}

const meta = {
  title: "Shared/Admin/Panes/Plugins",
  component: AdminPluginsPane,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof AdminPluginsPane>;

export default meta;
type Story = StoryObj<typeof AdminPluginsPane>;

export const Default: Story = {
  render: () => <PluginsPaneHarness />,
};

export const WithPlugins: Story = {
  render: () => (
    <PluginsPaneHarness
      dataOverride={{
        plugins: [
          { id: "drive", name: "Drive", active: true, source: "bundled" },
          { id: "calendar", name: "Calendar", active: true, source: "bundled" },
          { id: "contacts", name: "Contacts", active: false, source: "bundled" },
        ],
      }}
    />
  ),
};
