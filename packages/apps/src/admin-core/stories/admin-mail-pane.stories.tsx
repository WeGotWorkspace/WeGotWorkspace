import type { Meta, StoryObj } from "@storybook/react-vite";
import { AdminMailPane } from "@/admin-core/src/admin-mail-pane";
import { useAdminPaneStoryController } from "@/admin-core/stories/admin-pane-stories.harness";
import { AdminStoryScope } from "@/admin-core/stories/admin-story-scope";

function MailPaneHarness() {
  const controller = useAdminPaneStoryController();
  return (
    <AdminStoryScope>
      <AdminMailPane controller={controller} />
    </AdminStoryScope>
  );
}

const meta = {
  title: "Features/Admin/Panes/Mail",
  component: AdminMailPane,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof AdminMailPane>;

export default meta;
type Story = StoryObj<typeof AdminMailPane>;

export const Default: Story = {
  render: () => <MailPaneHarness />,
};
