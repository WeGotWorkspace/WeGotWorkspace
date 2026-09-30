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

export const ResetNeedsSixDigits: Story = {
  render: () => <MfaUsers callerEnabled />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await expect(canvas.queryByRole("button", { name: "Require 2FA" })).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "Reset 2FA" }));
    const dialog = await body.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "Reset 2FA" });
    await expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText("Authenticator code"), "123456");
    await expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText("Type alice to confirm"), "alice");
    await expect(confirm).toBeEnabled();
  },
};

export const AdminWithoutTotp: Story = {
  render: () => <MfaUsers callerEnabled={false} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("button", { name: "Require 2FA" })).toBeNull();
    await expect(canvas.queryByRole("button", { name: "Reset 2FA" })).toBeNull();
    await expect(
      canvas.queryByRole("link", { name: /Set up two-factor authentication/ }),
    ).toBeNull();
  },
};
