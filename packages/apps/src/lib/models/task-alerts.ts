import type { Task, TaskAlert, TaskPatch } from "@/lib/models/tasks-types";

/** Applies an alerts patch the way the API does: per id, null removes. */
export function applyTaskAlertsPatch(
  current: Task["alerts"] | null | undefined,
  patch: TaskPatch["alerts"] | undefined,
): Task["alerts"] | undefined {
  if (patch === undefined) return current ?? undefined;
  if (patch === null) return undefined;
  const merged: Record<string, TaskAlert> = {};
  for (const [id, alert] of Object.entries({ ...current, ...patch })) {
    if (alert) merged[id] = alert;
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}
