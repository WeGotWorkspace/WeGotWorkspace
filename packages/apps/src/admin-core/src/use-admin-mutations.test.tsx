import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminAppBootstrap } from "@/lib/api/mock/admin-bootstrap";
import { useAdminMutations } from "@/admin-core/src/use-admin-mutations";
import { useAdminShell } from "@/admin-core/src/use-admin-shell";
import type { AdminAPIOperations } from "@/admin-core/src/admin-types";

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
  "useThisAddress",
  "clearMailDeliverySmtpPassword",
  "clearTurnSecret",
  "sendMailDeliveryTest",
  "refresh",
  "checkUpdates",
  "setUpdateChannel",
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
  it("reports a saved site address by the refreshed warnings", async () => {
    const appUrlWarning =
      "APP_URL is not set; the Host header is not validated and password-reset mail is disabled.";
    const { data } = createAdminAppBootstrap();
    const start = { ...data, securityWarnings: [appUrlWarning] };
    const setAppUrl = vi
      .fn<AdminAPIOperations["setAppUrl"]>()
      .mockResolvedValueOnce(start)
      .mockResolvedValueOnce({ ...data, securityWarnings: [] });
    const operations = { setAppUrl } as unknown as AdminAPIOperations;
    const { result } = renderHook(() => {
      const shell = useAdminShell({ data: start });
      const mutations = useAdminMutations({ shell, operations });
      return { shell, mutations };
    });

    await act(async () => {
      expect(await result.current.mutations.actions.useThisAddress("http://x.test")).toBe(false);
    });
    expect(toast.showError).toHaveBeenCalledWith(
      "The address was saved, but the server still reports APP_URL as unset.",
    );
    expect(result.current.shell.securityWarnings).toEqual([appUrlWarning]);

    await act(async () => {
      expect(
        await result.current.mutations.actions.useThisAddress("https://team.example.org"),
      ).toBe(true);
    });
    expect(toast.showSuccess).toHaveBeenCalledWith("Site address saved");
    expect(result.current.shell.securityWarnings).toEqual([]);
  });
});
