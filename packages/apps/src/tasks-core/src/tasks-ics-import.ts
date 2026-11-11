import type { TaskImportError } from "@wgw/openapi-types/tasks-types";
import type { IcsImportDestination } from "@/lib/ics-import/ics-file";
import type { TasksUILabels } from "@/tasks-core/src/tasks-labels";
import type { TaskImportResponse, TaskList, TasksAPIOperations } from "@/lib/models/tasks-types";

export type TasksIcsImportOutcome = {
  result: TaskImportResponse;
  taskListId: string;
  /** Set when the import created its destination list first. */
  createdList?: TaskList;
};

/**
 * Create the destination list when asked, then import into it. The list stays
 * when the import itself fails, as in Calendar. The list is created on the
 * server or not at all: a list only queued offline would stay behind empty.
 */
export async function runTasksIcsImport(
  operations: TasksAPIOperations,
  icsText: string,
  destination: IcsImportDestination,
): Promise<TasksIcsImportOutcome> {
  if (!operations.importTasks) {
    throw new Error("ICS import is not available");
  }

  let taskListId = destination.mode === "existing" ? destination.collectionId : "";
  let createdList: TaskList | undefined;
  if (destination.mode === "create") {
    if (!operations.createTaskList) {
      throw new Error("Creating a list is not available");
    }
    createdList = await operations.createTaskList(
      {
        name: destination.name,
        ...(destination.color.trim() ? { color: destination.color.trim() } : {}),
      },
      { requireServer: true },
    );
    taskListId = createdList.id;
  }

  const result = await operations.importTasks(icsText, { taskListId });
  return { result, taskListId, createdList };
}

/** A clean import closes with a toast; anything else keeps the dialog open on its result. */
export function tasksImportNeedsResultStep(result: TaskImportResponse): boolean {
  return result.list.length === 0 || result.errors.length > 0 || result.skipped.events > 0;
}

export type TasksImportErrorLabels = Pick<
  TasksUILabels,
  "importErrorAlreadyExists" | "importErrorTooComplex" | "importUntitledTask"
>;

/** Readable reason for one task that could not be imported. */
export function tasksImportErrorReason(error: TaskImportError, L: TasksImportErrorLabels): string {
  if (error.code === "already_exists") return L.importErrorAlreadyExists;
  if (error.code === "payload_too_complex") return L.importErrorTooComplex;
  return error.message;
}

export function tasksImportErrorTitle(error: TaskImportError, L: TasksImportErrorLabels): string {
  return error.title?.trim() || L.importUntitledTask;
}
