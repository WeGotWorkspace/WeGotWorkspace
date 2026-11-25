import type { Meta, StoryObj } from "@storybook/react-vite";
import { AdminCalendarPane } from "@/admin-core/src/admin-calendar-pane";
import { useAdminPaneStoryController } from "@/admin-core/stories/admin-pane-stories.harness";
import { AdminPaneScope } from "@/admin-core/stories/admin-story-scope";

function CalendarPaneHarness() {
  const controller = useAdminPaneStoryController();
  return (
    <AdminPaneScope controller={controller}>
      <AdminCalendarPane controller={controller} />
    </AdminPaneScope>
  );
}

const meta = {
  title: "Features/Admin/Panes/Calendar",
  component: AdminCalendarPane,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof AdminCalendarPane>;

export default meta;
type Story = StoryObj<typeof AdminCalendarPane>;

export const Default: Story = {
  render: () => <CalendarPaneHarness />,
};
