import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import { registerBuiltinSettings } from "@/settings-core/src/register-builtin-settings";
import { WorkspaceAppSettingsFooter } from "@/settings-core/src/workspace-app-settings-footer";

registerBuiltinSettings();

const namedSession = {
  ...mockWorkspaceSession,
  user: {
    ...mockWorkspaceSession.user,
    displayName: "Demo User",
    username: "demo.user",
  },
};

const meta: Meta<typeof WorkspaceAppSettingsFooter> = {
  title: "Features/Settings/Dialog",
  component: WorkspaceAppSettingsFooter,
  parameters: {
    layout: "padded",
  },
  tags: ["vitest-ci"],
};

export default meta;
type Story = StoryObj<typeof WorkspaceAppSettingsFooter>;

export const MailPanel: Story = {
  args: {
    appId: "mail",
    session: namedSession,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Settings" }));
    const body = within(canvasElement.ownerDocument.body);
    await expect(body.findByRole("heading", { name: "Mail" })).resolves.toBeTruthy();
    await expect(body.findByText(/does not read a mailbox/i)).resolves.toBeTruthy();
  },
};

export const HiddenForNotes: Story = {
  args: {
    appId: "notes",
    session: namedSession,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("button", { name: "Settings" })).toBeNull();
    await expect(canvas.getByRole("button", { name: "Log out" })).toBeTruthy();
  },
};
