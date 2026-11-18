import type { Meta, StoryObj } from "@storybook/react-vite";
import { AdminHealthPane, adminSecurityChecks } from "@/admin-core/src/admin-health-pane";
import { useAdminPaneStoryController } from "@/admin-core/stories/admin-pane-stories.harness";
import { AdminStoryScope } from "@/admin-core/stories/admin-story-scope";
import type { SecurityCheck } from "@/admin-core/src/admin-health-pane";

function HealthPaneHarness({ checks }: { checks: SecurityCheck[] }) {
  const controller = useAdminPaneStoryController();
  return (
    <AdminStoryScope>
      <AdminHealthPane controller={controller} securityChecks={checks} />
    </AdminStoryScope>
  );
}

const base = {
  warnings: [],
  secureContext: true,
  reachableDirectories: [],
  baseUri: "/",
  origin: "https://team.example.org",
};

const meta = {
  title: "Features/Admin/Panes/Health",
  component: AdminHealthPane,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof AdminHealthPane>;

export default meta;
type Story = StoryObj<typeof AdminHealthPane>;

export const AllClear: Story = {
  render: () => <HealthPaneHarness checks={adminSecurityChecks(base)} />,
};

export const NeedsAttention: Story = {
  render: () => (
    <HealthPaneHarness
      checks={adminSecurityChecks({
        ...base,
        secureContext: false,
        warnings: [{ code: "app_debug_on", message: "APP_DEBUG is on." }],
      })}
    />
  ),
};
