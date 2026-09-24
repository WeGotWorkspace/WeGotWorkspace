import { Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog";
import { buttonVariants } from "@/ui/button";
import { GroupDialog, PasswordDialog, UserDialog } from "@/admin-core/src/admin-workspace-dialogs";
import type { AdminUIData } from "@/admin-core/src/admin-types";
import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import type { AdminControllerState } from "@/admin-core/src/use-admin-controller";

export type AdminWorkspaceModalsProps = {
  data: AdminUIData;
  session: WorkspaceSession;
  controller: AdminControllerState;
  newUserOpen: boolean;
  setNewUserOpen: (open: boolean) => void;
  setEditUserId: (id: string | null) => void;
  setPasswordUserId: (id: string | null) => void;
  newGroupOpen: boolean;
  setNewGroupOpen: (open: boolean) => void;
  setEditGroupId: (id: string | null) => void;
  setDeleteGroupId: (id: string | null) => void;
  confirmClearLogsOpen: boolean;
  setConfirmClearLogsOpen: (open: boolean) => void;
  confirmUpdateOpen: boolean;
  setConfirmUpdateOpen: (open: boolean) => void;
  updatingNow: boolean;
  setUpdatingNow: (value: boolean) => void;
  editingUser: AdminControllerState["users"][number] | null;
  passwordUser: AdminControllerState["users"][number] | null;
  editingGroup: AdminControllerState["groups"][number] | null;
  deletingGroup: AdminControllerState["groups"][number] | null;
};

export function AdminWorkspaceModals(props: AdminWorkspaceModalsProps) {
  const {
    data,
    session,
    controller,
    newUserOpen,
    setNewUserOpen,
    setEditUserId,
    setPasswordUserId,
    newGroupOpen,
    setNewGroupOpen,
    setEditGroupId,
    setDeleteGroupId,
    confirmClearLogsOpen,
    setConfirmClearLogsOpen,
    confirmUpdateOpen,
    setConfirmUpdateOpen,
    updatingNow,
    setUpdatingNow,
    editingUser,
    passwordUser,
    editingGroup,
    deletingGroup,
  } = props;

  return (
    <>
      <UserDialog
        open={newUserOpen}
        title="New user"
        onOpenChange={setNewUserOpen}
        onSubmit={async (payload) => {
          if (await controller.actions.createUser(payload)) {
            setNewUserOpen(false);
          }
        }}
      />
      <UserDialog
        open={Boolean(editingUser)}
        title="Edit user"
        initial={editingUser ?? undefined}
        onOpenChange={(next) => {
          if (!next) setEditUserId(null);
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
                }
              }
            : undefined
        }
      />
      <PasswordDialog
        open={Boolean(passwordUser)}
        user={passwordUser}
        onOpenChange={(next) => {
          if (!next) setPasswordUserId(null);
        }}
        onSubmit={async (values) => {
          if (!passwordUser) return;
          const ok = await controller.actions.updateUserPassword({
            userId: passwordUser.id,
            password: values.password,
            confirmPassword: values.confirmPassword,
          });
          if (ok) setPasswordUserId(null);
        }}
      />
      <GroupDialog
        open={newGroupOpen}
        title="New group"
        users={controller.users}
        currentUsername={data.currentUser || session.user.username || ""}
        onOpenChange={setNewGroupOpen}
        onSubmit={async (payload) => {
          if (await controller.actions.createGroup(payload.name)) {
            setNewGroupOpen(false);
          }
        }}
      />
      <GroupDialog
        open={Boolean(editingGroup)}
        title="Edit group"
        initial={editingGroup ?? undefined}
        users={controller.users}
        currentUsername={data.currentUser || session.user.username || ""}
        onOpenChange={(next) => {
          if (!next) setEditGroupId(null);
        }}
        onSubmit={async (payload) => {
          if (!editingGroup) return;
          const ok = await controller.actions.updateGroup(editingGroup.id, payload);
          if (ok) setEditGroupId(null);
        }}
      />

      <AlertDialog
        open={Boolean(deletingGroup)}
        onOpenChange={(next) => !next && setDeleteGroupId(null)}
      >
        <AlertDialogContent className="admin-dialog-surface">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete group?</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingGroup
                ? `“${deletingGroup.displayName}” will be removed. Members keep their accounts.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={async () => {
                if (!deletingGroup) return;
                if (await controller.actions.deleteGroup(deletingGroup.id)) {
                  setDeleteGroupId(null);
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmClearLogsOpen} onOpenChange={setConfirmClearLogsOpen}>
        <AlertDialogContent className="admin-dialog-surface">
          <AlertDialogHeader>
            <AlertDialogTitle>Clear update logs?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes all current update log lines from the log panel. This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={async () => {
                await controller.actions.clearUpdateLog();
                setConfirmClearLogsOpen(false);
              }}
            >
              Clear logs
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmUpdateOpen} onOpenChange={setConfirmUpdateOpen}>
        <AlertDialogContent className="admin-dialog-surface">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {`Update to ${controller.updates.latest?.version ?? "latest"}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              The server will create a pre-update backup and may restart. Active sessions could
              briefly disconnect.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={updatingNow}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={updatingNow}
              onClick={async () => {
                setConfirmUpdateOpen(false);
                setUpdatingNow(true);
                try {
                  await controller.actions.applyUpdate();
                } finally {
                  setUpdatingNow(false);
                }
              }}
            >
              {updatingNow ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Updating...
                </>
              ) : (
                "Update now"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
