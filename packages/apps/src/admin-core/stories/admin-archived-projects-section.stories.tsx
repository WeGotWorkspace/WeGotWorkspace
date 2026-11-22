import type { Meta, StoryObj } from "@storybook/react-vite";
import { AdminArchivedProjectsSection } from "@/admin-core/src/admin-archived-projects-section";
import { createMockAdminProjectOperations } from "@/admin-core/src/admin-projects-operations";
import { AdminStoryScope } from "@/admin-core/stories/admin-story-scope";
import { AppToaster } from "@/ui/sonner";

const meta = {
  title: "Features/Admin/Panes/Archived Projects",
  component: AdminArchivedProjectsSection,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof AdminArchivedProjectsSection>;

export default meta;
type Story = StoryObj<typeof AdminArchivedProjectsSection>;

/** Archived Projects of every Team; Delete permanently asks for the Project's name. */
export const Default: Story = {
  render: () => (
    <AdminStoryScope>
      <AppToaster />
      <AdminArchivedProjectsSection operations={createMockAdminProjectOperations()} />
    </AdminStoryScope>
  ),
};

export const Empty: Story = {
  render: () => (
    <AdminStoryScope>
      <AdminArchivedProjectsSection operations={createMockAdminProjectOperations([])} />
    </AdminStoryScope>
  ),
};
