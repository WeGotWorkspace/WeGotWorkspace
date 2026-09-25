import {
  createTemporaryPassword,
  localCreatedUser,
  mapUserEnabled,
  mapUserProfile,
  removeUserById,
  validateCreateUser,
  validatePasswordChange,
} from "@/admin-core/src/admin-user-directory";
import { mutationErrorMessage } from "@/admin-core/src/admin-mutation-feedback";
import type { AdminMutationSliceArgs } from "@/admin-core/src/admin-mutation-slice";

type UserShell = AdminMutationSliceArgs<"users" | "setUsers" | "currentUser" | "applyAdminData">;

export function useAdminUserMutations({ operations, shell, showSuccess, showError }: UserShell) {
  const { users, setUsers, currentUser, applyAdminData } = shell;

  const createUser = async (input: { username: string; displayName: string; email: string }) => {
    const decision = validateCreateUser(users, input.username);
    if (!decision.ok) {
      showError(decision.message);
      return false;
    }
    if (operations?.createUser) {
      try {
        const next = await operations.createUser({
          username: decision.username,
          password: createTemporaryPassword(),
          displayName: input.displayName.trim(),
          email: input.email.trim() || undefined,
          groups: [],
        });
        applyAdminData(next);
        showSuccess("User created");
        return true;
      } catch (error) {
        showError(mutationErrorMessage(error, "Could not create user"));
        return false;
      }
    }
    setUsers((prev) => [
      ...prev,
      localCreatedUser({
        username: decision.username,
        displayName: input.displayName,
        email: input.email,
        createdAt: new Date().toISOString(),
      }),
    ]);
    showSuccess("User created");
    return true;
  };

  const updateUser = async (
    userId: string,
    input: { displayName: string; email: string; username?: string },
  ) => {
    if (operations?.updateUser) {
      try {
        const next = await operations.updateUser(input.username ?? userId, {
          displayName: input.displayName.trim(),
          email: input.email.trim() || "",
        });
        applyAdminData(next);
        showSuccess("User updated");
        return true;
      } catch (error) {
        showError(mutationErrorMessage(error, "Could not update user"));
        return false;
      }
    }
    setUsers((prev) => mapUserProfile(prev, userId, input));
    showSuccess("User updated");
    return true;
  };

  const setUserEnabled = async (userId: string, enabled: boolean) => {
    const user = users.find((candidate) => candidate.id === userId);
    if (!user) {
      return false;
    }
    if (!enabled && user.username === currentUser) {
      showError("You cannot disable your own account.");
      return false;
    }
    if (operations?.updateUser) {
      try {
        const next = await operations.updateUser(user.username, { enabled });
        applyAdminData(next);
        showSuccess(enabled ? "User enabled" : "User disabled");
        return true;
      } catch (error) {
        showError(mutationErrorMessage(error, "Could not update user"));
        return false;
      }
    }
    setUsers((prev) => mapUserEnabled(prev, userId, enabled));
    showSuccess(enabled ? "User enabled" : "User disabled");
    return true;
  };

  const deleteUser = async (userId: string) => {
    if (operations?.deleteUser) {
      try {
        const next = await operations.deleteUser(userId);
        applyAdminData(next);
        showSuccess("User deleted");
        return true;
      } catch (error) {
        showError(mutationErrorMessage(error, "Could not delete user"));
        return false;
      }
    }
    setUsers((prev) => removeUserById(prev, userId));
    showSuccess("User deleted");
    return true;
  };

  const updateUserPassword = async (input: {
    userId: string;
    password: string;
    confirmPassword: string;
  }) => {
    const passwordError = validatePasswordChange(input.password, input.confirmPassword);
    if (passwordError) {
      showError(passwordError);
      return false;
    }
    if (operations?.updateUser) {
      try {
        const next = await operations.updateUser(input.userId, { password: input.password });
        applyAdminData(next);
      } catch (error) {
        showError(mutationErrorMessage(error, "Could not update password"));
        return false;
      }
    }
    showSuccess("Password updated");
    return true;
  };

  return { createUser, updateUser, setUserEnabled, deleteUser, updateUserPassword };
}
