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

/** Opens a row's "…" menu and returns the menu's queries (it renders in a portal). */
async function openRowMenu(canvasElement: HTMLElement, displayName: string) {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole("button", { name: `More actions for ${displayName}` }));
  return within(await within(canvasElement.ownerDocument.body).findByRole("menu"));
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
    // Your own account cannot be disabled; a disabled one offers Enable.
    const ownMenu = await openRowMenu(canvasElement, "Alice Example");
    await expect(ownMenu.getByRole("menuitem", { name: "Disable account" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await userEvent.keyboard("{Escape}");
    const carolMenu = await openRowMenu(canvasElement, "Carol Example");
    await expect(carolMenu.getByRole("menuitem", { name: "Enable account" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");

    const bobMenu = await openRowMenu(canvasElement, "Bob Example");
    await userEvent.click(bobMenu.getByRole("menuitem", { name: "Disable account" }));
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

    await userEvent.click(
      (await openRowMenu(canvasElement, "Bob Example")).getByRole("menuitem", { name: "Edit" }),
    );
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

/** #1925: admin is a role per user, switched on in the user dialog. */
export const AdminRole: Story = {
  tags: ["vitest-ci"],
  render: () => <UsersPaneHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await expect(canvas.getAllByText("Admin")).toHaveLength(1);

    await userEvent.click(
      (await openRowMenu(canvasElement, "Alice Example")).getByRole("menuitem", { name: "Edit" }),
    );
    const ownDialog = await body.findByRole("dialog", { name: "Edit user" });
    const ownSwitch = within(ownDialog).getByRole("switch", { name: "Administrator" });
    await expect(ownSwitch).toHaveAttribute("aria-checked", "true");
    await expect(ownSwitch).toBeDisabled();
    await expect(ownDialog).toHaveTextContent("You cannot remove your own administrator access.");
    await userEvent.click(within(ownDialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(body.queryByRole("dialog")).toBeNull();
    });

    await userEvent.click(
      (await openRowMenu(canvasElement, "Bob Example")).getByRole("menuitem", { name: "Edit" }),
    );
    const bobDialog = await body.findByRole("dialog", { name: "Edit user" });
    const bobSwitch = within(bobDialog).getByRole("switch", { name: "Administrator" });
    await expect(bobSwitch).toHaveAttribute("aria-checked", "false");
    await expect(bobSwitch).toBeEnabled();
    await userEvent.click(bobSwitch);
    await userEvent.click(within(bobDialog).getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(body.queryByRole("dialog")).toBeNull();
      expect(canvas.getAllByText("Admin")).toHaveLength(2);
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
    const ownMenu = await openRowMenu(canvasElement, "Alice Example");
    await expect(ownMenu.queryByRole("menuitem", { name: "Reset two-factor sign-in" })).toBeNull();
    await userEvent.keyboard("{Escape}");

    await userEvent.click(
      (await openRowMenu(canvasElement, "Bob Example")).getByRole("menuitem", {
        name: "Reset two-factor sign-in",
      }),
    );
    const confirm = await body.findByRole("alertdialog");
    await expect(confirm).toHaveTextContent("Reset two-factor sign-in for Bob Example?");
    await userEvent.click(within(confirm).getByRole("button", { name: "Reset" }));
    await waitFor(() => {
      expect(canvas.getAllByText("Two-factor")).toHaveLength(1);
    });
    toast.dismiss();
  },
};
