import { useRef, useState } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AppToastApi } from "@/hooks/use-app-toast";
import type { AdminAPIOperations, AdminUpdateState } from "@/admin-core/src/admin-types";
import { downloadPlainTextLines } from "@/admin-core/src/admin-update-log-download";
import { useAdminUpdateMutations } from "@/admin-core/src/use-admin-update-mutations";
import { createAdminAppBootstrap } from "@/lib/api/mock/admin-bootstrap";

vi.mock("@/admin-core/src/admin-update-log-download", () => ({
  downloadPlainTextLines: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderUpdates(
  operations?: Partial<AdminAPIOperations>,
  updatesPatch?: Partial<AdminUpdateState>,
) {
  const showSuccess = vi.fn() as AppToastApi["showSuccess"];
  const showError = vi.fn() as AppToastApi["showError"];
  const data = createAdminAppBootstrap().data;
  const view = renderHook(() => {
    const [updates, setUpdates] = useState({ ...data.updates, ...updatesPatch });
    const [updateLogLines, setUpdateLogLines] = useState(data.updateLogLines);
    const applyRequestPendingRef = useRef(false);
    const actions = useAdminUpdateMutations({
      operations: operations as AdminAPIOperations | undefined,
      showSuccess,
      showError,
      shell: { updates, setUpdates, updateLogLines, setUpdateLogLines, applyRequestPendingRef },
    });
    return { ...actions, updates, updateLogLines, applyRequestPendingRef };
  });
  return { ...view, showSuccess, showError };
}

describe("useAdminUpdateMutations", () => {
  it("toggles the check flag and stores the returned snapshot", async () => {
    const data = createAdminAppBootstrap().data;
    const gate = deferred<typeof data>();
    const checkUpdates = vi.fn(() => gate.promise);
    const { result, showSuccess } = renderUpdates({ checkUpdates });

    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.checkUpdates();
      await Promise.resolve();
    });
    expect(result.current.checkingUpdates).toBe(true);

    await act(async () => {
      gate.resolve({
        ...data,
        updates: { ...data.updates, installedVersion: "2.0.0" },
        updateLogLines: ["checked"],
      });
      await pending;
    });

    expect(result.current.checkingUpdates).toBe(false);
    expect(result.current.updates.installedVersion).toBe("2.0.0");
    expect(result.current.updateLogLines).toEqual(["checked"]);
    expect(showSuccess).toHaveBeenCalledWith("Update check completed");
  });

  it("refreshes server checks without replacing the log", async () => {
    const data = createAdminAppBootstrap().data;
    const refreshUpdateState = vi.fn().mockResolvedValue({
      ...data.updates,
      lastCheckedAt: "2026-09-25T00:00:00.000Z",
    });
    const { result, showSuccess } = renderUpdates({ refreshUpdateState });
    await act(async () => {
      await result.current.refreshServerChecks();
    });
    expect(result.current.refreshingServerChecks).toBe(false);
    expect(result.current.updates.lastCheckedAt).toBe("2026-09-25T00:00:00.000Z");
    expect(result.current.updateLogLines).toEqual([]);
    expect(showSuccess).toHaveBeenCalledWith("Server checks refreshed");
  });

  it("keeps the log when clear returns nothing and downloads non-empty lines", async () => {
    const refreshUpdateLog = vi.fn().mockResolvedValue(["alpha"]);
    const { result, showSuccess, showError } = renderUpdates({ refreshUpdateLog });

    await act(async () => {
      await result.current.downloadUpdateLog();
    });
    expect(result.current.updateLogLines).toEqual(["alpha"]);
    expect(downloadPlainTextLines).toHaveBeenCalledWith(expect.stringMatching(/^update-log-/), [
      "alpha",
    ]);
    expect(showSuccess).toHaveBeenCalledWith("Update log downloaded");

    refreshUpdateLog.mockResolvedValueOnce(undefined);
    const empty = renderUpdates();
    await act(async () => {
      await empty.result.current.downloadUpdateLog();
    });
    expect(empty.showError).toHaveBeenCalledWith("No update logs to download");
    expect(showError).not.toHaveBeenCalled();
  });

  it("marks an apply as pending, then stores the completed run", async () => {
    const data = createAdminAppBootstrap().data;
    const gate = deferred<AdminUpdateState>();
    const applyUpdate = vi.fn(() => gate.promise);
    const { result, showSuccess } = renderUpdates({ applyUpdate });

    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.applyUpdate();
      await Promise.resolve();
    });
    expect(result.current.applyRequestPendingRef.current).toBe(true);
    expect(result.current.updates.inProgress).toBe(true);
    expect(result.current.updates.phase).toBe("downloading");

    const finished = { ...data.updates, inProgress: true, installedVersion: "3.0.0" };
    await act(async () => {
      gate.resolve(finished);
      await pending;
    });
    expect(result.current.applyRequestPendingRef.current).toBe(false);
    expect(result.current.updates.installedVersion).toBe("3.0.0");
    expect(showSuccess).toHaveBeenCalledWith("Update run started");
  });

  it("clears optimistic progress when apply and the follow-up refresh both fail", async () => {
    const applyUpdate = vi.fn().mockRejectedValue(new Error("apply failed"));
    const refreshUpdateState = vi.fn().mockRejectedValue(new Error("refresh failed"));
    const { result, showError } = renderUpdates({ applyUpdate, refreshUpdateState });

    await act(async () => {
      await result.current.applyUpdate();
    });

    expect(result.current.updates.inProgress).toBe(false);
    expect(result.current.updates.phase).toBeNull();
    expect(result.current.applyRequestPendingRef.current).toBe(false);
    expect(showError).toHaveBeenCalledWith("apply failed");
  });

  it("replaces state from a successful refresh after a failed apply", async () => {
    const data = createAdminAppBootstrap().data;
    const latest = { ...data.updates, installedVersion: "kept", inProgress: false };
    const { result } = renderUpdates({
      applyUpdate: vi.fn().mockRejectedValue(new Error("apply failed")),
      refreshUpdateState: vi.fn().mockResolvedValue(latest),
    });

    await act(async () => {
      await result.current.applyUpdate();
    });

    expect(result.current.updates.installedVersion).toBe("kept");
  });
});
