import type { Meta, StoryObj } from "@storybook/react-vite";
import { AdminRealtimeCollaborationPane } from "@/admin-core/src/admin-realtime-collaboration-pane";
import {
  type AdminStoryDataOverride,
  useAdminPaneStoryController,
} from "@/admin-core/stories/admin-pane-stories.harness";
import { AdminStoryScope } from "@/admin-core/stories/admin-story-scope";

function RealtimeCollaborationPaneHarness({
  dataOverride,
}: {
  dataOverride?: AdminStoryDataOverride;
}) {
  const controller = useAdminPaneStoryController(dataOverride);
  return (
    <AdminStoryScope>
      <AdminRealtimeCollaborationPane controller={controller} />
    </AdminStoryScope>
  );
}

const meta = {
  title: "Features/Admin/Panes/Collaboration",
  component: AdminRealtimeCollaborationPane,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof AdminRealtimeCollaborationPane>;

export default meta;
type Story = StoryObj<typeof AdminRealtimeCollaborationPane>;

export const Default: Story = {
  render: () => <RealtimeCollaborationPaneHarness />,
};
