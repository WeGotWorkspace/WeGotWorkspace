import { mutationErrorMessage } from "@/admin-core/src/admin-mutation-feedback";
import type { AdminMutationSliceArgs } from "@/admin-core/src/admin-mutation-slice";

export function useAdminPluginMutations({
  operations,
  shell,
  showSuccess,
  showError,
}: AdminMutationSliceArgs<"applyAdminData">) {
  const { applyAdminData } = shell;

  const setPluginActive = async (pluginId: string, active: boolean) => {
    const operation = active ? operations?.activatePlugin : operations?.deactivatePlugin;
    if (!operation) {
      showError("Plugin API is not ready yet");
      return false;
    }
    try {
      const next = await operation(pluginId);
      applyAdminData(next);
      showSuccess(active ? "Plugin activated" : "Plugin deactivated");
      return true;
    } catch (error) {
      showError(mutationErrorMessage(error, "Could not update plugin state"));
      return false;
    }
  };

  const installPluginZip = async (file: File) => {
    if (!operations?.installPluginZip) {
      showError("Plugin install API is not ready yet");
      return false;
    }
    try {
      const next = await operations.installPluginZip(file);
      applyAdminData(next);
      showSuccess("Plugin installed");
      return true;
    } catch (error) {
      showError(mutationErrorMessage(error, "Could not install plugin ZIP"));
      return false;
    }
  };

  return { setPluginActive, installPluginZip };
}
