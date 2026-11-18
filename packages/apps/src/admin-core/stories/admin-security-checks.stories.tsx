import type { Meta, StoryObj } from "@storybook/react-vite";
import { AdminSecurityChecks, adminSecurityChecks } from "@/admin-core/src/admin-health-pane";
import { AdminStoryScope } from "@/admin-core/stories/admin-story-scope";

const meta = {
  title: "Features/Admin/Security checks",
  component: AdminSecurityChecks,
  decorators: [
    (Story) => (
      <AdminStoryScope>
        <Story />
      </AdminStoryScope>
    ),
  ],
  args: { onUseThisAddress: async () => true },
} satisfies Meta<typeof AdminSecurityChecks>;

export default meta;
type Story = StoryObj<typeof meta>;

const base = {
  warnings: [],
  secureContext: true,
  reachableDirectories: [],
  baseUri: "/",
  origin: "https://team.example.org",
};

/** Every check passes. */
export const AllClear: Story = { args: { checks: adminSecurityChecks(base) } };

/** Problems first: Critical (with a Fix link), then Warning, then the checks that pass. */
export const Problems: Story = {
  args: {
    checks: adminSecurityChecks({
      ...base,
      secureContext: false,
      reachableDirectories: ["packages"],
      warnings: [
        { code: "app_debug_on", message: "APP_DEBUG is on." },
        { code: "app_url_unset", message: "APP_URL is not set." },
      ],
    }),
  },
};

/** Admin open on a local address: the APP_URL row only informs. */
export const LocalAddress: Story = {
  args: {
    checks: adminSecurityChecks({
      ...base,
      origin: "http://localhost:8080",
      warnings: [{ code: "app_url_local", message: "APP_URL is a local address." }],
    }),
  },
};
