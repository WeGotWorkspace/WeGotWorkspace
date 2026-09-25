import { backupDownloadUrl } from "@/admin-core/src/admin-update-progress";
import { mutationErrorMessage } from "@/admin-core/src/admin-mutation-feedback";
import type { AdminMutationSliceArgs } from "@/admin-core/src/admin-mutation-slice";

export function useAdminBackupMutations({
  operations,
  shell,
  showSuccess,
  showError,
}: AdminMutationSliceArgs<"setUpdates" | "setUpdateLogLines">) {
  const { setUpdates, setUpdateLogLines } = shell;

  const deleteBackup = async (name: string) => {
    try {
      const next = await operations?.deleteBackup(name);
      if (!next) return;
      setUpdates(next.updates);
      setUpdateLogLines(next.updateLogLines);
      showSuccess("Backup deleted");
    } catch (error) {
      showError(mutationErrorMessage(error, "Could not delete backup"));
    }
  };

  const createBackup = async () => {
    try {
      const next = await operations?.createBackup();
      if (!next) {
        showError("Manual backup creation endpoint is not available yet.");
        return;
      }
      setUpdates(next.updates);
      setUpdateLogLines(next.updateLogLines);
      showSuccess("Backup created");
    } catch (error) {
      showError(mutationErrorMessage(error, "Could not create backup"));
    }
  };

  const downloadBackup = async (name: string) => {
    try {
      if (operations?.downloadBackup) {
        await operations.downloadBackup(name);
        return;
      }
      window.open(backupDownloadUrl(name), "_blank");
    } catch (error) {
      showError(mutationErrorMessage(error, "Could not download backup"));
    }
  };

  return { deleteBackup, createBackup, downloadBackup };
}
