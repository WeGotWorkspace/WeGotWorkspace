import { mutationErrorMessage } from "@/admin-core/src/admin-mutation-feedback";
import type { AdminMutationSliceArgs } from "@/admin-core/src/admin-mutation-slice";

export function useAdminStateRefresh({
  operations,
  shell,
  showSuccess,
  showError,
}: AdminMutationSliceArgs<"applyAdminData">) {
  const { applyAdminData } = shell;

  const refresh = async () => {
    try {
      const next = await operations?.refreshState();
      if (!next) return;
      applyAdminData(next);
      showSuccess("Admin state refreshed");
    } catch (error) {
      showError(mutationErrorMessage(error, "Could not refresh admin state"));
    }
  };

  return { refresh };
}
