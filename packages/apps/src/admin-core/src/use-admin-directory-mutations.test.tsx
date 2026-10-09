import { useState } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AppToastApi } from "@/hooks/use-app-toast";
import type { AdminAPIOperations } from "@/admin-core/src/admin-types";
import { useAdminGroupMutations } from "@/admin-core/src/use-admin-group-mutations";
import { createAdminAppBootstrap } from "@/lib/api/mock/admin-bootstrap";

function toasts() {
  return {
    showSuccess: vi.fn() as AppToastApi["showSuccess"],
    showError: vi.fn() as AppToastApi["showError"],
  };
}

describe("useAdminGroupMutations", () => {
  function renderGroups(operations?: Partial<AdminAPIOperations>) {
    const toast = toasts();
    const data = createAdminAppBootstrap().data;
    const view = renderHook(() => {
      const [groups, setGroups] = useState(data.groups);
      const [users, setUsers] = useState(data.users);
      const applyAdminData = vi.fn();
      const actions = useAdminGroupMutations({
        operations: operations as AdminAPIOperations | undefined,
        ...toast,
        shell: { groups, setGroups, users, setUsers, applyAdminData },
      });
      return { ...actions, groups, users, applyAdminData };
    });
    return { ...view, ...toast };
  }

  it("creates a local group, assigns members, and strips them on delete", async () => {
    const { result, showSuccess } = renderGroups();
    await act(async () => {
      expect(await result.current.createGroup(" Ops Team ")).toBe(true);
      expect(
        await result.current.updateGroup("principals/groups/ops-team", {
          name: "Operations",
          memberUserIds: ["carol"],
        }),
      ).toBe(true);
    });
    expect(result.current.groups[1]).toMatchObject({
      id: "principals/groups/ops-team",
      name: "Operations",
    });
    expect(result.current.users.find((user) => user.id === "carol")?.groups).toEqual([
      "principals/groups/ops-team",
    ]);

    await act(async () => {
      expect(await result.current.deleteGroup("principals/groups/ops-team")).toBe(true);
    });
    expect(result.current.groups).toHaveLength(1);
    expect(result.current.users.find((user) => user.id === "carol")?.groups).toEqual([]);
    expect(showSuccess).toHaveBeenCalledWith("Group deleted");
  });

  it("protects the administrators group and passes member usernames to the API", async () => {
    const data = createAdminAppBootstrap().data;
    const updateGroup = vi.fn().mockResolvedValue(data);
    const { result, showError, showSuccess } = renderGroups({ updateGroup });

    await act(async () => {
      expect(await result.current.deleteGroup("principals/groups/administrators")).toBe(false);
      expect(
        await result.current.updateGroup("principals/groups/administrators", {
          name: "Admins",
          memberUserIds: ["carol", "alice"],
        }),
      ).toBe(true);
    });

    expect(showError).toHaveBeenCalledWith(
      "The administrators group is protected and cannot be deleted.",
    );
    expect(updateGroup).toHaveBeenCalledWith("principals/groups/administrators", {
      displayName: "Admins",
      members: ["alice", "carol"],
    });
    expect(result.current.applyAdminData).toHaveBeenCalledWith(data);
    expect(showSuccess).toHaveBeenCalledWith("Group saved");
  });
});
