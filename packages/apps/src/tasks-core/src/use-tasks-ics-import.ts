import { useCallback, useState } from "react";
import { useAppToast } from "@/hooks/use-app-toast";
import { TasksRequestError } from "@/lib/api/wgw/tasks";
import { icsHasComponent, readIcsFile } from "@/lib/ics-import/ics-file";
import type { IcsImportDestination } from "@/lib/ics-import/ics-import-dialog";
import { readBrowserOnline } from "@/lib/offline/core/browser-online";
import { TASKS_IMPORT_OFFLINE_MESSAGE } from "@/lib/offline/tasks/tasks-hybrid-operations";
import { runTasksIcsImport, tasksImportNeedsResultStep } from "@/tasks-core/src/tasks-ics-import";
import type { TasksUILabels } from "@/tasks-core/src/tasks-labels";
import type {
  Task,
  TaskImportResponse,
  TaskList,
  TasksAPIOperations,
} from "@/lib/models/tasks-types";

export type TasksImportedChange = {
  taskListId: string;
  createdList?: TaskList;
  tasks: Task[];
};

export type UseTasksIcsImportOptions = {
  operations?: TasksAPIOperations;
  labels: Pick<
    TasksUILabels,
    | "importFileInvalid"
    | "importNoTasksInFile"
    | "importFileTooLarge"
    | "importFailed"
    | "importOffline"
    | "importedTasks"
  >;
  /** New list and imported tasks, so the workspace can show and select them. */
  onImported: (change: TasksImportedChange) => void;
};

export type TasksIcsImportState = {
  canImportTasks: boolean;
  importFile: File | null;
  importDialogBusy: boolean;
  importDialogError: string | null;
  importResult: TaskImportResponse | null;
  beginImport: (file: File) => void;
  closeImportDialog: () => void;
  submitImportDialog: (file: File, destination: IcsImportDestination) => void;
};

function importFailureMessage(error: unknown, L: UseTasksIcsImportOptions["labels"]): string {
  if (error instanceof TasksRequestError) {
    if (error.status === 413) return L.importFileTooLarge;
    return error.message.trim() || L.importFailed;
  }
  if (error instanceof Error && error.message === TASKS_IMPORT_OFFLINE_MESSAGE) {
    return L.importOffline;
  }
  return L.importFailed;
}

export function useTasksIcsImport({
  operations,
  labels: L,
  onImported,
}: UseTasksIcsImportOptions): TasksIcsImportState {
  const { show } = useAppToast();
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importDialogBusy, setImportDialogBusy] = useState(false);
  const [importDialogError, setImportDialogError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<TaskImportResponse | null>(null);

  const canImportTasks = Boolean(operations?.importTasks);

  const beginImport = useCallback(
    (file: File) => {
      if (!canImportTasks) return;
      setImportDialogError(null);
      setImportResult(null);
      setImportFile(file);
    },
    [canImportTasks],
  );

  const closeImportDialog = useCallback(() => {
    if (importDialogBusy) return;
    setImportFile(null);
    setImportDialogError(null);
    setImportResult(null);
  }, [importDialogBusy]);

  const submitImportDialog = useCallback(
    (file: File, destination: IcsImportDestination) => {
      if (!operations?.importTasks) return;
      setImportDialogBusy(true);
      setImportDialogError(null);
      void (async () => {
        let createdList: TaskList | undefined;
        try {
          const icsText = await readIcsFile(file);
          if (icsText.trim() === "") {
            setImportDialogError(L.importFileInvalid);
            return;
          }
          // Checked here, before a new list is created for nothing.
          if (!icsHasComponent(icsText, "VTODO")) {
            setImportDialogError(L.importNoTasksInFile);
            return;
          }
          // Also checked here: the dialog may have opened while online.
          if (!readBrowserOnline()) {
            setImportDialogError(L.importOffline);
            return;
          }
          const createTaskList = operations.createTaskList;
          const outcome = await runTasksIcsImport(
            {
              ...operations,
              // Remember the created list, so it still shows when the import throws.
              createTaskList: createTaskList
                ? async (body, opts) => {
                    createdList = await createTaskList(body, opts);
                    return createdList;
                  }
                : undefined,
            },
            icsText,
            destination,
          );
          const { result, taskListId } = outcome;
          onImported({ taskListId, createdList, tasks: result.list });
          createdList = undefined;
          if (result.list.length > 0) {
            show(L.importedTasks(result.list.length));
          }
          if (tasksImportNeedsResultStep(result)) {
            setImportResult(result);
          } else {
            setImportFile(null);
          }
        } catch (error) {
          if (createdList) {
            onImported({ taskListId: createdList.id, createdList, tasks: [] });
          }
          setImportDialogError(importFailureMessage(error, L));
        } finally {
          setImportDialogBusy(false);
        }
      })();
    },
    [L, onImported, operations, show],
  );

  return {
    canImportTasks,
    importFile,
    importDialogBusy,
    importDialogError,
    importResult,
    beginImport,
    closeImportDialog,
    submitImportDialog,
  };
}
