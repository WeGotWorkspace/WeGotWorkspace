import type { Meta, StoryObj } from "@storybook/react-vite";
import { AdminWebdavPane } from "@/admin-core/src/admin-webdav-pane";
import { useAdminPaneStoryController } from "@/admin-core/stories/admin-pane-stories.harness";
import { AdminPaneScope } from "@/admin-core/stories/admin-story-scope";

function WebdavPaneHarness() {
  const controller = useAdminPaneStoryController();
  return (
    <AdminPaneScope controller={controller}>
      <AdminWebdavPane controller={controller} />
    </AdminPaneScope>
  );
}

const meta = {
  title: "Features/Admin/Panes/WebDAV",
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
