import type { Meta, StoryObj } from "@storybook/react-vite";
import { AdminSecurityWarnings } from "@/admin-core/src/admin-workspace";
import { AdminStoryScope } from "@/admin-core/stories/admin-story-scope";

const APP_URL_WARNING =
  "APP_URL is not set; the Host header is not validated and password-reset mail is disabled.";

const meta = {
  title: "Features/Admin/Security warnings",
  component: AdminSecurityWarnings,
  decorators: [
    (Story) => (
      <AdminStoryScope>
        <Story />
      </AdminStoryScope>
    ),
  ],
  args: {
    warnings: [APP_URL_WARNING],
    baseUri: "/",
    onUseThisAddress: async () => true,
  },
} satisfies Meta<typeof AdminSecurityWarnings>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A public address: the button saves it as APP_URL. */
export const PublicAddress: Story = {
  args: { origin: "https://team.example.org" },
};

/** A local address: no button, because the API ignores a loopback APP_URL. */
export const LocalAddress: Story = {
  args: { origin: "http://localhost:8080" },
};

export const OtherWarning: Story = {
  args: {
    origin: "https://team.example.org",
    warnings: ["APP_DEBUG is on. Error responses can include exception details."],
  },
};
