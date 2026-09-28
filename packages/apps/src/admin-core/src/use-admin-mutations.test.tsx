import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminAppBootstrap } from "@/lib/api/mock/admin-bootstrap";
import { useAdminMutations } from "@/admin-core/src/use-admin-mutations";
import { useAdminShell } from "@/admin-core/src/use-admin-shell";

const toast = vi.hoisted(() => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
}));

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({
    show: vi.fn(),
    showSuccess: toast.showSuccess,
    showError: toast.showError,
    dismiss: vi.fn(),
  }),
}));

const ACTION_NAMES = [
  "saveSettings",
  "clearMailDeliverySmtpPassword",
  "sendMailDeliveryTest",
  "refresh",
  "checkUpdates",
  "refreshServerChecks",
  "clearUpdateLog",
  "refreshUpdateLog",
  "downloadUpdateLog",
  "deleteBackup",
  "createBackup",
  "downloadBackup",
  "applyUpdate",
  "cancelUpdate",
  "startSearchReindex",
  "refreshSearchReindexState",
  "cancelSearchReindex",
  "createUser",
  "updateUser",
  "setUserEnabled",
  "deleteUser",
  "updateUserPassword",
  "createGroup",
  "updateGroup",
  "deleteGroup",
  "setPluginActive",
  "installPluginZip",
] as const;

describe("useAdminMutations", () => {
  beforeEach(() => {
    toast.showSuccess.mockReset();
    toast.showError.mockReset();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  });

  it("wires every admin action onto the shell", async () => {
    const { data } = createAdminAppBootstrap();
    const { result } = renderHook(() => {
      const shell = useAdminShell({ data });
      const mutations = useAdminMutations({ shell });
      return { shell, mutations };
    });

    expect(Object.keys(result.current.mutations.actions)).toEqual([...ACTION_NAMES]);
    expect(result.current.mutations.checkingUpdates).toBe(false);
    expect(result.current.mutations.refreshingServerChecks).toBe(false);

    await act(async () => {
      await result.current.mutations.actions.saveSettings();
      expect(await result.current.mutations.actions.setUserEnabled("alice", false)).toBe(false);
      expect(await result.current.mutations.actions.createGroup("Ops Team")).toBe(true);
    });

    expect(toast.showError).toHaveBeenCalledWith("Admin API is not ready yet");
    expect(toast.showError).toHaveBeenCalledWith("You cannot disable your own account.");
    expect(result.current.shell.groups.map((group) => group.id)).toContain(
      "principals/groups/ops-team",
    );
  });
});
