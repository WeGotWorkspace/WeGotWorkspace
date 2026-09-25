import type { AppToastApi } from "@/hooks/use-app-toast";
import type { AdminSearchReindexState } from "@/admin-core/src/admin-types";
import { mutationErrorMessage } from "@/admin-core/src/admin-mutation-feedback";
import type { AdminMutationSliceArgs } from "@/admin-core/src/admin-mutation-slice";

type SearchLoad = (() => Promise<AdminSearchReindexState>) | undefined;

async function commitSearchReindex(input: {
  load: SearchLoad;
  setSearchReindex: (next: AdminSearchReindexState) => void;
  showSuccess: AppToastApi["showSuccess"];
  showError: AppToastApi["showError"];
  successMessage: string;
  failureMessage: string;
}): Promise<void> {
  try {
    const next = await input.load?.();
    if (!next) {
      input.showError("Search reindex API is not ready yet");
      return;
    }
    input.setSearchReindex(next);
    input.showSuccess(input.successMessage);
  } catch (error) {
    input.showError(mutationErrorMessage(error, input.failureMessage));
  }
}

export function useAdminSearchMutations({
  operations,
  shell,
  showSuccess,
  showError,
}: AdminMutationSliceArgs<"setSearchReindex">) {
  const { setSearchReindex } = shell;

  const startSearchReindex = () =>
    commitSearchReindex({
      load: operations?.startSearchReindex,
      setSearchReindex,
      showSuccess,
      showError,
      successMessage: "Search reindex started",
      failureMessage: "Could not start search reindex",
    });

  const refreshSearchReindexState = () =>
    commitSearchReindex({
      load: operations?.refreshSearchReindexState,
      setSearchReindex,
      showSuccess,
      showError,
      successMessage: "Search reindex state refreshed",
      failureMessage: "Could not refresh search reindex state",
    });

  const cancelSearchReindex = () =>
    commitSearchReindex({
      load: operations?.cancelSearchReindex,
      setSearchReindex,
      showSuccess,
      showError,
      successMessage: "Search reindex cancellation requested",
      failureMessage: "Could not cancel search reindex",
    });

  return { startSearchReindex, refreshSearchReindexState, cancelSearchReindex };
}
