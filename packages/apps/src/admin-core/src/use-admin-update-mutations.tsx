import { useState } from "react";
import { downloadPlainTextLines } from "@/admin-core/src/admin-update-log-download";
import {
  applyUpdateSuccessMessage,
  clearedUpdateProgress,
  optimisticUpdateRun,
  updateLogFileName,
} from "@/admin-core/src/admin-update-progress";
import { mutationErrorMessage } from "@/admin-core/src/admin-mutation-feedback";
import type { AdminMutationSliceArgs } from "@/admin-core/src/admin-mutation-slice";

type UpdateShell = AdminMutationSliceArgs<
  "updates" | "setUpdates" | "updateLogLines" | "setUpdateLogLines" | "applyRequestPendingRef"
>;

export function useAdminUpdateMutations({
  operations,
  shell,
  showSuccess,
  showError,
}: UpdateShell) {
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [refreshingServerChecks, setRefreshingServerChecks] = useState(false);
  const { updates, setUpdates, updateLogLines, setUpdateLogLines, applyRequestPendingRef } = shell;

  const checkUpdates = async () => {
    setCheckingUpdates(true);
    try {
      const next = await operations?.checkUpdates();
      if (!next) return;
      setUpdates(next.updates);
      setUpdateLogLines(next.updateLogLines);
      showSuccess("Update check completed");
    } catch (error) {
      showError(mutationErrorMessage(error, "Update check failed"));
    } finally {
      setCheckingUpdates(false);
    }
  };

  /** Re-fetch update state (including server checks) without running POST /updates/check. */
  const refreshServerChecks = async () => {
    setRefreshingServerChecks(true);
    try {
      const next = await operations?.refreshUpdateState();
      if (!next) return;
      setUpdates(next);
      showSuccess("Server checks refreshed");
    } catch (error) {
      showError(mutationErrorMessage(error, "Could not refresh server checks"));
    } finally {
      setRefreshingServerChecks(false);
    }
  };

  const clearUpdateLog = async () => {
    try {
      const lines = await operations?.clearUpdateLog();
      if (lines) setUpdateLogLines(lines);
      showSuccess("Update logs cleared");
    } catch (error) {
      showError(mutationErrorMessage(error, "Could not clear update logs"));
    }
  };

  const refreshUpdateLog = async () => {
    try {
      const lines = await operations?.refreshUpdateLog();
      if (lines) setUpdateLogLines(lines);
      showSuccess("Update logs refreshed");
    } catch (error) {
      showError(mutationErrorMessage(error, "Could not refresh update logs"));
    }
  };

  const downloadUpdateLog = async () => {
    try {
      const lines = (await operations?.refreshUpdateLog()) ?? updateLogLines;
      if (lines.length === 0) {
        showError("No update logs to download");
        return;
      }
      setUpdateLogLines(lines);
      downloadPlainTextLines(updateLogFileName(new Date().toISOString()), lines);
      showSuccess("Update log downloaded");
    } catch (error) {
      showError(mutationErrorMessage(error, "Could not download update logs"));
    }
  };

  const applyUpdate = async () => {
    applyRequestPendingRef.current = true;
    try {
      const wasInProgress = updates.inProgress;
      const requestedVersion = updates.latest?.version ?? updates.installedVersion;
      if (!wasInProgress) {
        const startedAt = new Date().toISOString();
        setUpdates((prev) => optimisticUpdateRun(prev, startedAt, requestedVersion));
      }
      const next = await operations?.applyUpdate(updates.latest?.version);
      if (!next) return;
      setUpdates(next);
      showSuccess(applyUpdateSuccessMessage(next, wasInProgress));
    } catch (error) {
      try {
        const latest = await operations?.refreshUpdateState();
        if (latest) setUpdates(latest);
      } catch {
        setUpdates((prev) => clearedUpdateProgress(prev));
      }
      showError(mutationErrorMessage(error, "Could not apply update"));
    } finally {
      applyRequestPendingRef.current = false;
    }
  };

  const cancelUpdate = async () => {
    try {
      const next = await operations?.cancelUpdate();
      if (!next) return;
      setUpdates(next);
      showSuccess("Cancel requested");
    } catch (error) {
      showError(mutationErrorMessage(error, "Could not cancel update"));
    }
  };

  return {
    checkingUpdates,
    refreshingServerChecks,
    checkUpdates,
    refreshServerChecks,
    clearUpdateLog,
    refreshUpdateLog,
    downloadUpdateLog,
    applyUpdate,
    cancelUpdate,
  };
}
