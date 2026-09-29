import { useMemo } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { AdminUsersPane } from "@/admin-core/src/admin-users-pane";
import {
  buildGroupMemberCountFromController,
  useAdminPaneStoryController,
} from "@/admin-core/stories/admin-pane-stories.harness";
import { AdminStoryScope } from "@/admin-core/stories/admin-story-scope";

function MfaUsers({ callerEnabled }: { callerEnabled: boolean }) {
  const dataOverride = useMemo(
    () => ({
      currentUser: "alice",
      users: [
        {
          id: "alice",
          username: "alice",
          email: "alice@example.test",
          displayName: "Alice Example",
          groups: [],
          createdAt: "",
          enabled: true,
          mfaEnabled: callerEnabled,
        },
        {
          id: "bob",
          username: "bob",
          email: "bob@example.test",
          displayName: "Bob Example",
          groups: [],
          createdAt: "",
          enabled: true,
          mfaEnabled: false,
        },
      ],
    }),
    [callerEnabled],
  );
  const controller = useAdminPaneStoryController(dataOverride);
  return (
    <AdminUsersPane
      controller={controller}
      groupMemberCount={buildGroupMemberCountFromController(controller)}
      onNewUser={() => undefined}
      onEditUser={() => undefined}
      onPasswordUser={() => undefined}
      onNewGroup={() => undefined}
      onEditGroup={() => undefined}
      onDeleteGroup={() => undefined}
      mfaPolicy={{
        required: false,
        callerEnabled,
        onEnforce: () => undefined,
        onReset: () => undefined,
      }}
    />
  );
}

const meta = {
  title: "Features/Admin/Two-factor",
  decorators: [
    (Story) => (
      <AdminStoryScope>
        <Story />
      </AdminStoryScope>
    ),
  ],
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const EnforceNeedsSixDigits: Story = {
  render: () => <MfaUsers callerEnabled />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(canvas.getByRole("button", { name: "Require 2FA" }));
    const dialog = await body.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "Require 2FA" });
    await expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText("Authenticator code"), "12345");
    await expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText("Authenticator code"), "6");
    await expect(confirm).toBeEnabled();
  },
};

export const AdminWithoutTotp: Story = {
  render: () => <MfaUsers callerEnabled={false} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("link", { name: /Set up two-factor authentication/ }),
    ).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "Require 2FA" })).toBeNull();
  },
};
