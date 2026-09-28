import { useState } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AppToastApi } from "@/hooks/use-app-toast";
import type { AdminAPIOperations } from "@/admin-core/src/admin-types";
import { useAdminUserMutations } from "@/admin-core/src/use-admin-user-mutations";
import { createAdminAppBootstrap } from "@/lib/api/mock/admin-bootstrap";

function toasts() {
  return {
    showSuccess: vi.fn() as AppToastApi["showSuccess"],
    showError: vi.fn() as AppToastApi["showError"],
  };
}

function renderUsers(operations?: Partial<AdminAPIOperations>) {
  const toast = toasts();
  const data = createAdminAppBootstrap().data;
  const applyAdminData = vi.fn();
  const view = renderHook(() => {
    const [users, setUsers] = useState(data.users);
    const actions = useAdminUserMutations({
      operations: operations as AdminAPIOperations | undefined,
      ...toast,
      shell: { users, setUsers, currentUser: data.currentUser, applyAdminData },
    });
    return { ...actions, users };
  });
  return { ...view, ...toast, applyAdminData };
}

describe("useAdminUserMutations", () => {
  it("creates a local user and rejects a duplicate", async () => {
    const { result, showSuccess, showError } = renderUsers();
    await act(async () => {
      expect(
        await result.current.createUser({
          username: " Bob ",
          displayName: " Bob ",
          email: " bob@example.test ",
        }),
      ).toBe(true);
      expect(
        await result.current.createUser({ username: "alice", displayName: "A", email: "" }),
      ).toBe(false);
    });
    expect(result.current.users.map((user) => user.username)).toContain("Bob");
    expect(showSuccess).toHaveBeenCalledWith("User created");
    expect(showError).toHaveBeenCalledWith("Username already exists");
  });

  it("sends a temporary password through the API", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("11111111-1111-4111-8111-111111111111");
    const data = createAdminAppBootstrap().data;
    const next = {
      ...data,
      users: [...data.users, { ...data.users[0], id: "bob", username: "bob" }],
    };
    const createUser = vi.fn().mockResolvedValue(next);
    const { result, showSuccess, applyAdminData } = renderUsers({ createUser });

    await act(async () => {
      expect(
        await result.current.createUser({
          username: "bob",
          displayName: "Bob",
          email: "  ",
        }),
      ).toBe(true);
    });

    expect(createUser).toHaveBeenCalledWith({
      username: "bob",
      password: "Temp-11111111-1111-4111-8111-111111111111",
      displayName: "Bob",
      email: undefined,
      groups: [],
    });
    expect(applyAdminData).toHaveBeenCalledWith(next);
    expect(showSuccess).toHaveBeenCalledWith("User created");
    vi.restoreAllMocks();
  });

  it("refuses to disable the signed-in account and enables someone else locally", async () => {
    const { result, showError, showSuccess } = renderUsers();
    await act(async () => {
      expect(await result.current.setUserEnabled("missing", false)).toBe(false);
      expect(await result.current.setUserEnabled("alice", false)).toBe(false);
      expect(await result.current.setUserEnabled("carol", true)).toBe(true);
    });
    expect(showError).toHaveBeenCalledWith("You cannot disable your own account.");
    expect(showSuccess).toHaveBeenCalledWith("User enabled");
    expect(result.current.users.find((user) => user.id === "carol")?.enabled).toBe(true);
  });

  it("does not toast success when a password update fails", async () => {
    const updateUser = vi.fn().mockRejectedValue(new Error("weak"));
    const { result, showError, showSuccess } = renderUsers({ updateUser });
    await act(async () => {
      expect(
        await result.current.updateUserPassword({
          userId: "alice",
          password: "long-enough",
          confirmPassword: "long-enough",
        }),
      ).toBe(false);
    });
    expect(showError).toHaveBeenCalledWith("weak");
    expect(showSuccess).not.toHaveBeenCalled();
  });

  it("updates a password locally when the API is absent", async () => {
    const { result, showSuccess } = renderUsers();
    await act(async () => {
      expect(
        await result.current.updateUserPassword({
          userId: "alice",
          password: "long-enough",
          confirmPassword: "long-enough",
        }),
      ).toBe(true);
    });
    expect(showSuccess).toHaveBeenCalledWith("Password updated");
  });
});
