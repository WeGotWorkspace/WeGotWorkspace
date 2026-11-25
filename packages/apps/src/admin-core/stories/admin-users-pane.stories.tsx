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
          isAdmin: true,
          mfaEnabled: true,
        },
        {
          id: "bob",
          username: "bob",
          email: "bob@example.test",
          displayName: "Bob Example",
          groups: [],
          createdAt: "",
          enabled: true,
          isAdmin: false,
          mfaEnabled: true,
        },
        {
          id: "carol",
          username: "carol",
          email: "carol@example.test",
          displayName: "Carol Example",
          groups: [],
          createdAt: "",
          enabled: false,
          isAdmin: false,
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
        isSelf={editingUser?.username === controller.currentUser}
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

/** Opens the row's more-options menu; its items portal into the document body. */
async function openRowMenu(canvas: ReturnType<typeof within>, displayName: string) {
  await userEvent.click(canvas.getByRole("button", { name: `More options: ${displayName}` }));
}

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
    // Carol is disabled: her menu offers Enable. Your own row never offers Disable.
    await openRowMenu(canvas, "Carol Example");
    await expect(await body.findByRole("menuitem", { name: "Enable account" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await openRowMenu(canvas, "Alice Example");
    await expect(await body.findByRole("menuitem", { name: "Set password" })).toBeInTheDocument();
    await expect(body.queryByRole("menuitem", { name: "Disable account" })).toBeNull();
    await userEvent.keyboard("{Escape}");

    await openRowMenu(canvas, "Bob Example");
    await userEvent.click(await body.findByRole("menuitem", { name: "Disable account" }));
    const disableDialog = await body.findByRole("alertdialog");
    await expect(disableDialog).toHaveTextContent("Disable Bob Example?");
    await expect(disableDialog).toHaveTextContent("They will not be able to sign in");
    await userEvent.click(body.getByRole("button", { name: "Disable" }));
    await waitFor(() => {
      expect(canvas.getAllByText("Disabled")).toHaveLength(2);
    });
    await waitFor(() => {
      expect(body.getAllByText("User disabled").length).toBeGreaterThan(0);
    });

    await openRowMenu(canvas, "Bob Example");
    await userEvent.click(await body.findByRole("menuitem", { name: "Edit" }));
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

/** #1925: admin is a role per user, switched on in the user dialog (chip: Org admin). */
export const AdminRole: Story = {
  tags: ["vitest-ci"],
  render: () => <UsersPaneHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await expect(canvas.getAllByText("Org admin")).toHaveLength(1);

    await openRowMenu(canvas, "Alice Example");
    await userEvent.click(await body.findByRole("menuitem", { name: "Edit" }));
    const ownDialog = await body.findByRole("dialog", { name: "Edit user" });
    const ownSwitch = within(ownDialog).getByRole("switch", { name: "Organization admin" });
    await expect(ownSwitch).toHaveAttribute("aria-checked", "true");
    await expect(ownSwitch).toBeDisabled();
    await expect(ownDialog).toHaveTextContent(
      "You cannot remove your own organization admin role.",
    );
    await userEvent.click(within(ownDialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(body.queryByRole("dialog")).toBeNull();
    });

    await openRowMenu(canvas, "Bob Example");
    await userEvent.click(await body.findByRole("menuitem", { name: "Edit" }));
    const bobDialog = await body.findByRole("dialog", { name: "Edit user" });
    const bobSwitch = within(bobDialog).getByRole("switch", { name: "Organization admin" });
    await expect(bobSwitch).toHaveAttribute("aria-checked", "false");
    await expect(bobSwitch).toBeEnabled();
    await userEvent.click(bobSwitch);
    await userEvent.click(within(bobDialog).getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(body.queryByRole("dialog")).toBeNull();
      expect(canvas.getAllByText("Org admin")).toHaveLength(2);
    });
    toast.dismiss();
  },
};

/**
 * #2275: who has two-factor on, and the admin reset behind a confirm. Not on your own row:
 * you turn yours off in Settings → Security (decided by Wouter 2026-11-20).
 */
export const ResetTwoFactor: Story = {
  tags: ["vitest-ci"],
  render: () => <UsersPaneHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await expect(canvas.getAllByText("Two-factor")).toHaveLength(2);
    await openRowMenu(canvas, "Alice Example");
    await expect(await body.findByRole("menuitem", { name: "Set password" })).toBeInTheDocument();
    await expect(body.queryByRole("menuitem", { name: "Reset two-factor sign-in" })).toBeNull();
    await userEvent.keyboard("{Escape}");

    await openRowMenu(canvas, "Bob Example");
    await userEvent.click(await body.findByRole("menuitem", { name: "Reset two-factor sign-in" }));
    const confirm = await body.findByRole("alertdialog");
    await expect(confirm).toHaveTextContent("Reset two-factor sign-in for Bob Example?");
    await userEvent.click(within(confirm).getByRole("button", { name: "Reset" }));
    await waitFor(() => {
      expect(canvas.getAllByText("Two-factor")).toHaveLength(1);
    });
    toast.dismiss();
  },
};
