import type { AppToastApi } from "@/hooks/use-app-toast";
import type { AdminAPIOperations } from "@/lib/models/admin-types";
import type { AdminShellState } from "@/admin-core/src/use-admin-shell";

export type AdminMutationSliceArgs<K extends keyof AdminShellState> = {
  operations?: AdminAPIOperations;
  shell: Pick<AdminShellState, K>;
  showSuccess: AppToastApi["showSuccess"];
  showError: AppToastApi["showError"];
};
