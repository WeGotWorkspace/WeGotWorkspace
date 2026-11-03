import type { Meta, StoryObj } from "@storybook/react-vite";
import type { AdminSecurityWarning } from "@/admin-core/src/admin-types";
import { AdminSecurityWarnings } from "@/admin-core/src/admin-workspace";
import { AdminStoryScope } from "@/admin-core/stories/admin-story-scope";

const APP_URL_WARNING: AdminSecurityWarning = {
  code: "app_url_unset",
  message:
    "APP_URL is not set; the Host header is not validated and password-reset mail is disabled.",
};
const LOCAL_APP_URL_WARNING: AdminSecurityWarning = {
  code: "app_url_local",
  message:
    "APP_URL is a local address (http://localhost:8080). Host checks and password-reset mail stay off until it is the site's public address: reset links must point there.",
};
const DEBUG_WARNING: AdminSecurityWarning = {
  code: "app_debug_on",
  message: "APP_DEBUG is on. Error responses can include exception details.",
};

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

/** Admin open on a local address: an info note, no button (the API ignores a loopback APP_URL). */
export const LocalAddress: Story = {
  args: { origin: "http://localhost:8080", warnings: [LOCAL_APP_URL_WARNING] },
};

/** APP_URL is local, but Admin is open on the public address: fixable here. */
export const LocalAppUrlOnPublicAddress: Story = {
  args: { origin: "https://team.example.org", warnings: [LOCAL_APP_URL_WARNING] },
};

export const OtherWarning: Story = {
  args: {
    origin: "https://team.example.org",
    warnings: [DEBUG_WARNING],
  },
};
