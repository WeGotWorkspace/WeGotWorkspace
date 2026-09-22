import type { Meta, StoryObj } from "@storybook/react-vite";
import { AdminWebdavPane } from "@/admin-core/src/admin-webdav-pane";
import { useAdminPaneStoryController } from "@/admin-core/stories/admin-pane-stories.harness";
import { AdminStoryScope } from "@/admin-core/stories/admin-story-scope";

function WebdavPaneHarness() {
  const controller = useAdminPaneStoryController();
  return (
    <AdminStoryScope>
      <AdminWebdavPane controller={controller} />
    </AdminStoryScope>
  );
}

const meta = {
  title: "Shared/Admin/Panes/WebDAV",
  component: AdminWebdavPane,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof AdminWebdavPane>;

export default meta;
type Story = StoryObj<typeof AdminWebdavPane>;

export const Default: Story = {
  render: () => <WebdavPaneHarness />,
};
