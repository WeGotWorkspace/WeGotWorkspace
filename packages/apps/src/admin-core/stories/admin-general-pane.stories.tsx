import type { Meta, StoryObj } from "@storybook/react-vite";
import { AdminGeneralPane } from "@/admin-core/src/admin-general-pane";
import { useAdminPaneStoryController } from "@/admin-core/stories/admin-pane-stories.harness";
import { AdminPaneScope } from "@/admin-core/stories/admin-story-scope";

function GeneralPaneHarness() {
  const controller = useAdminPaneStoryController();
  return (
    <AdminPaneScope controller={controller}>
      <AdminGeneralPane controller={controller} />
    </AdminPaneScope>
  );
}

const meta = {
  title: "Features/Admin/Panes/General",
  component: AdminGeneralPane,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof AdminGeneralPane>;

export default meta;
type Story = StoryObj<typeof AdminGeneralPane>;

export const Default: Story = {
  render: () => <GeneralPaneHarness />,
};
