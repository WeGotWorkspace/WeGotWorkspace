import { useState } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AppToastApi } from "@/hooks/use-app-toast";
import type { AdminAPIOperations } from "@/admin-core/src/admin-types";
import { useAdminBackupMutations } from "@/admin-core/src/use-admin-backup-mutations";
import { useAdminSearchMutations } from "@/admin-core/src/use-admin-search-mutations";
import { useAdminStateRefresh } from "@/admin-core/src/use-admin-state-refresh";
import { createAdminAppBootstrap } from "@/lib/api/mock/admin-bootstrap";

function toasts() {
  return {
    showSuccess: vi.fn() as AppToastApi["showSuccess"],
    showError: vi.fn() as AppToastApi["showError"],
  };
}

describe("useAdminBackupMutations", () => {
  function renderBackups(operations?: Partial<AdminAPIOperations>) {
    const toast = toasts();
    const data = createAdminAppBootstrap().data;
    const view = renderHook(() => {
      const [updates, setUpdates] = useState(data.updates);
      const [updateLogLines, setUpdateLogLines] = useState(data.updateLogLines);
      const actions = useAdminBackupMutations({
        operations: operations as AdminAPIOperations | undefined,
        ...toast,
        shell: { setUpdates, setUpdateLogLines },
      });
      return { ...actions, updates, updateLogLines };
    });
    return { ...view, ...toast };
  }

  it("stores a created backup and explains a missing endpoint", async () => {
    const data = createAdminAppBootstrap().data;
    const created = {
      ...data,
      updates: { ...data.updates, installedVersion: "backed-up" },
      updateLogLines: ["backup"],
    };
    const createBackup = vi.fn().mockResolvedValueOnce(created).mockResolvedValueOnce(undefined);
    const { result, showSuccess, showError } = renderBackups({ createBackup });

    await act(async () => {
      await result.current.createBackup();
      await result.current.createBackup();
    });

    expect(result.current.updates.installedVersion).toBe("backed-up");
    expect(result.current.updateLogLines).toEqual(["backup"]);
    expect(showSuccess).toHaveBeenCalledWith("Backup created");
    expect(showError).toHaveBeenCalledWith("Manual backup creation endpoint is not available yet.");
  });

  it("opens the backup url when download is not injected", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const { result } = renderBackups();
    await act(async () => {
      await result.current.downloadBackup("release 1/backup.zip");
    });
    expect(open).toHaveBeenCalledWith(
      "/api/v1/admin/updates/backups/release%201%2Fbackup.zip",
      "_blank",
    );
    open.mockRestore();
  });

  it("uses the injected download and surfaces its failure", async () => {
    const downloadBackup = vi.fn().mockRejectedValue(new Error("denied"));
    const { result, showError } = renderBackups({ downloadBackup });
    await act(async () => {
      await result.current.downloadBackup("backup.zip");
    });
    expect(downloadBackup).toHaveBeenCalledWith("backup.zip");
    expect(showError).toHaveBeenCalledWith("denied");
  });
});

describe("useAdminSearchMutations", () => {
  it("toasts when search operations are missing and stores a started run", async () => {
    const toast = toasts();
    const data = createAdminAppBootstrap().data;
    const started = { ...data.searchReindex, inProgress: true, phase: "indexing" };
    const startSearchReindex = vi.fn().mockResolvedValue(started);
    const { result } = renderHook(() => {
      const [searchReindex, setSearchReindex] = useState(data.searchReindex);
      const actions = useAdminSearchMutations({
        operations: { startSearchReindex } as unknown as AdminAPIOperations,
        ...toast,
        shell: { setSearchReindex },
      });
      return { ...actions, searchReindex };
    });

    await act(async () => {
      await result.current.refreshSearchReindexState();
      await result.current.startSearchReindex();
    });

    expect(toast.showError).toHaveBeenCalledWith("Search reindex API is not ready yet");
    expect(result.current.searchReindex.inProgress).toBe(true);
    expect(toast.showSuccess).toHaveBeenCalledWith("Search reindex started");
  });
});

describe("useAdminStateRefresh", () => {
  it("applies a refreshed snapshot and reports a failure", async () => {
    const toast = toasts();
    const data = createAdminAppBootstrap().data;
    const next = { ...data, currentUser: "carol" };
    const applyAdminData = vi.fn();
    const refreshState = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(next)
      .mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() =>
      useAdminStateRefresh({
        operations: { refreshState } as unknown as AdminAPIOperations,
        ...toast,
        shell: { applyAdminData },
      }),
    );

    await act(async () => {
      await result.current.refresh();
      await result.current.refresh();
      await result.current.refresh();
    });

    expect(applyAdminData).toHaveBeenCalledTimes(1);
    expect(applyAdminData).toHaveBeenCalledWith(next);
    expect(toast.showSuccess).toHaveBeenCalledWith("Admin state refreshed");
    expect(toast.showError).toHaveBeenCalledWith("offline");
  });
});
