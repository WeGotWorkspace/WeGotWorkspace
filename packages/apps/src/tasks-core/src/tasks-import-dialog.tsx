import { useMemo } from "react";
import {
  IcsImportDialog,
  type IcsImportDestination,
  type IcsImportDialogResult,
} from "@/lib/ics-import/ics-import-dialog";
import { tasksImportErrorReason, tasksImportErrorTitle } from "@/tasks-core/src/tasks-ics-import";
import type { TasksUILabels } from "@/tasks-core/src/tasks-labels";
import { TaskListIcon } from "@/tasks-core/src/tasks-list-icon";
import {
  canWriteTaskList,
  DEFAULT_TASK_LIST_COLOR,
  defaultTaskListId,
  TASK_LIST_DOT_COLORS,
  taskListDotColor,
} from "@/tasks-core/src/tasks-task-utils";
import type { TaskImportResponse, TaskList } from "@/tasks-core/src/tasks-types";

export type TasksImportDialogProps = {
  open: boolean;
  file: File;
  labels: TasksUILabels;
  taskLists: TaskList[];
  /** The list in view, preselected when it is writable. */
  preferredTaskListId?: string;
  busy?: boolean;
  error?: string | null;
  result?: TaskImportResponse | null;
  onClose: () => void;
  onImport: (file: File, destination: IcsImportDestination) => void;
};

function tasksImportResultView(
  result: TaskImportResponse,
  L: TasksUILabels,
): IcsImportDialogResult {
  const imported = result.list.length;
  return {
    summary: imported > 0 ? L.importedTasks(imported) : L.importNoneImported,
    nothingImported: imported === 0,
    skipped: {
      heading: L.importNotImportedHeading(result.errors.length),
      rows: result.errors.map((error) => ({
        key: `${error.index}-${error.uid ?? ""}`,
        name: tasksImportErrorTitle(error, L),
        reason: tasksImportErrorReason(error, L),
      })),
    },
    notes: {
      heading: L.importNotesHeading,
      items: result.skipped.events > 0 ? [L.importEventsSkipped(result.skipped.events)] : [],
    },
    doneLabel: L.importDone,
  };
}

/** The list in view when it is writable (shared lists too), else the usual default. */
function importDefaultListId(writable: TaskList[], preferredId?: string): string | undefined {
  if (writable.length === 0) return undefined;
  if (preferredId && writable.some((list) => list.id === preferredId)) return preferredId;
  return defaultTaskListId(writable);
}

export function TasksImportDialog({
  open,
  file,
  labels: L,
  taskLists,
  preferredTaskListId,
  busy = false,
  error = null,
  result = null,
  onClose,
  onImport,
}: TasksImportDialogProps) {
  const writable = useMemo(() => taskLists.filter((list) => canWriteTaskList(list)), [taskLists]);
  const collections = useMemo(
    () =>
      writable.map((list) => ({
        id: list.id,
        name: list.name,
        color: taskListDotColor(list),
        icon: <TaskListIcon list={list} />,
      })),
    [writable],
  );

  return (
    <IcsImportDialog
      open={open}
      file={file}
      idPrefix="tasks"
      contentClassName="tasks-dialog-surface"
      labels={{
        title: L.importDialogTitle,
        destinationLegend: L.importDestinationLegend,
        newCollection: L.importNewList,
        nameLabel: L.projectNameLabel,
        colorLabel: L.projectColorLabel,
        cancel: L.cancel,
        submit: L.importSubmit,
      }}
      collections={collections}
      defaultCollectionId={importDefaultListId(writable, preferredTaskListId)}
      swatches={TASK_LIST_DOT_COLORS}
      defaultColor={DEFAULT_TASK_LIST_COLOR}
      busy={busy}
      error={error}
      result={result ? tasksImportResultView(result, L) : null}
      onClose={onClose}
      onImport={onImport}
    />
  );
}
