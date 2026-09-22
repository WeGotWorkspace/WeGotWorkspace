import { useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { toast } from "sonner";
import { AdminUsersPane } from "@/admin-core/src/admin-users-pane";
import { UserDialog } from "@/admin-core/src/admin-workspace-dialogs";
import {
  buildGroupMemberCountFromController,
  useAdminPaneStoryController,
} from "@/admin-core/stories/admin-pane-stories.harness";
import { AdminStoryScope } from "@/admin-core/stories/admin-story-scope";
import { AppToaster } from "@/ui/sonner";

function UsersPaneHarness() {
  const dataOverride = useMemo(
    () => ({
      currentUser: "alice",
      users: [
        {
          id: "alice",
          username: "alice",
          email: "alice@example.test",
          displayName: "Alice Example",
          groups: ["principals/groups/administrators"],
          createdAt: "",
          enabled: true,
        },
        {
          id: "bob",
          username: "bob",
          email: "bob@example.test",
          displayName: "Bob Example",
          groups: [],
          createdAt: "",
          enabled: true,
        },
        {
          id: "carol",
          username: "carol",
          email: "carol@example.test",
          displayName: "Carol Example",
          groups: [],
          createdAt: "",
          enabled: false,
        },
      ],
    }),
    [],
  );
  const controller = useAdminPaneStoryController(dataOverride);
  const groupMemberCount = buildGroupMemberCountFromController(controller);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [editUserId, setEditUserId] = useState<string | null>(null);
  const editingUser = controller.users.find((user) => user.id === editUserId) ?? null;

  return (
    <AdminStoryScope>
      <AppToaster />
      <AdminUsersPane
        controller={controller}
        groupMemberCount={groupMemberCount}
        onNewUser={() => setLastAction("new-user")}
        onEditUser={setEditUserId}
        onPasswordUser={() => setLastAction("password-user")}
        onNewGroup={() => setLastAction("new-group")}
        onEditGroup={(groupId) => setLastAction(`edit-group:${groupId}`)}
        onDeleteGroup={() => setLastAction("delete-group")}
      />
      <UserDialog
        open={Boolean(editingUser)}
        title="Edit user"
        initial={editingUser ?? undefined}
        onOpenChange={(open) => {
          if (!open) setEditUserId(null);
        }}
        onSubmit={async (payload) => {
          if (!editingUser) return;
          if (await controller.actions.updateUser(editingUser.id, payload)) {
            setEditUserId(null);
          }
        }}
        onDelete={
          editingUser
            ? async () => {
                if (await controller.actions.deleteUser(editingUser.id)) {
                  setEditUserId(null);
                  setLastAction("delete-user");
                }
              }
            : undefined
        }
      />
      {lastAction ? <p role="status">{`Action: ${lastAction}`}</p> : null}
    </AdminStoryScope>
  );
}

const meta = {
  title: "Features/Admin/Panes/Users",
  component: AdminUsersPane,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof AdminUsersPane>;

export default meta;
type Story = StoryObj<typeof AdminUsersPane>;

export const Default: Story = {
  tags: ["vitest-ci"],
  render: () => <UsersPaneHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await expect(canvas.getByText("Alice Example")).toBeInTheDocument();
    await expect(canvas.getByText("Bob Example")).toBeInTheDocument();
    await expect(canvas.getByText("Carol Example")).toBeInTheDocument();
    await expect(canvas.getByText("Disabled")).toBeInTheDocument();
    await expect(canvas.getByRole("switch", { name: "Enable account" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await expect(
      canvas.getByRole("switch", { name: "You cannot disable your own account." }),
    ).toBeDisabled();
    await expect(canvas.queryByRole("button", { name: /Delete Alice Example/ })).toBeNull();

    await userEvent.click(canvas.getByRole("switch", { name: "Disable account" }));
    const disableDialog = await body.findByRole("alertdialog");
    await expect(disableDialog).toHaveTextContent("Disable Bob Example?");
    await expect(disableDialog).toHaveTextContent("They will not be able to sign in");
    await userEvent.click(body.getByRole("button", { name: "Disable" }));
    await waitFor(() => {
      expect(canvas.getAllByRole("switch", { name: "Enable account" })).toHaveLength(2);
    });
    await expect(canvas.getAllByText("Disabled")).toHaveLength(2);
    await waitFor(() => {
      expect(body.getAllByText("User disabled").length).toBeGreaterThan(0);
    });

    await userEvent.click(canvas.getByRole("button", { name: "Edit Bob Example" }));
    await expect(await body.findByRole("dialog", { name: "Edit user" })).toBeInTheDocument();
    await userEvent.click(body.getByRole("button", { name: "Delete user" }));
    await expect(await body.findByRole("alertdialog")).toHaveTextContent("Delete user?");
    await userEvent.click(body.getByRole("button", { name: "Delete" }));
    await expect(await canvas.findByRole("status")).toHaveTextContent("Action: delete-user");
    await expect(canvas.queryByText("Bob Example")).not.toBeInTheDocument();
    await expect(canvas.getByText("Alice Example")).toBeInTheDocument();
    await expect(canvas.getByText("Carol Example")).toBeInTheDocument();
    await expect(canvas.getByText("Disabled")).toBeInTheDocument();
    toast.dismiss();
    await waitFor(() => {
      expect(body.queryAllByText("User disabled")).toHaveLength(0);
    });
  },
};
