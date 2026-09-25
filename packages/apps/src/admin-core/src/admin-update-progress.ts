import type { AdminUpdateState } from "@/admin-core/src/admin-types";

export function optimisticUpdateRun(
  prev: AdminUpdateState,
  startedAt: string,
  requestedVersion: string,
): AdminUpdateState {
  return {
    ...prev,
    inProgress: true,
    phase: prev.phase ?? "downloading",
    current:
      prev.current ??
      ({
        from: prev.installedVersion,
        to: requestedVersion,
        at: startedAt,
      } as NonNullable<typeof prev.current>),
    cancelRequested: false,
    lastResult: null,
  };
}

export function clearedUpdateProgress(prev: AdminUpdateState): AdminUpdateState {
  return {
    ...prev,
    inProgress: false,
    phase: null,
    current: null,
    download: null,
    phaseProgress: null,
    cancelRequested: false,
    cancelAllowed: false,
  };
}

export function applyUpdateSuccessMessage(next: AdminUpdateState, wasInProgress: boolean): string {
  if (next.inProgress && !wasInProgress) {
    return "Update run started";
  }
  if (next.inProgress && wasInProgress) {
    return "Update is already in progress";
  }
  return "Update request completed";
}

export function updateLogFileName(isoTimestamp: string): string {
  return `update-log-${isoTimestamp.replace(/[:]/g, "-")}.log`;
}

export function backupDownloadUrl(name: string): string {
  return `/api/v1/admin/updates/backups/${encodeURIComponent(name)}`;
}
