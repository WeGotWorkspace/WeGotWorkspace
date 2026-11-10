import { useMemo } from "react";
import { Callout } from "@/callout/src/callout";
import { IcsImportDialog, type IcsImportDestination } from "@/lib/ics-import/ics-import-dialog";
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
import "./tasks-import-dialog.css";

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

function TasksImportResult({ result, L }: { result: TaskImportResponse; L: TasksUILabels }) {
  const imported = result.list.length;
  return (
    <>
      <p className="tasks-import-result__summary">
        {imported > 0 ? L.importedTasks(imported) : L.importNoneImported}
      </p>
      {result.errors.length > 0 ? (
        <Callout
          severity="warning"
          title={L.importNotImportedHeading(result.errors.length)}
          message={
            <ul className="tasks-import-result__errors">
              {result.errors.map((error) => (
                <li key={`${error.index}-${error.uid ?? ""}`}>
                  <span className="tasks-import-result__error-title">
                    {tasksImportErrorTitle(error, L)}
                  </span>
                  {" — "}
                  {tasksImportErrorReason(error, L)}
                </li>
              ))}
            </ul>
          }
        />
      ) : null}
      {result.skipped.events > 0 ? (
        <p className="tasks-import-result__skipped">
          {L.importEventsSkipped(result.skipped.events)}
        </p>
      ) : null}
    </>
  );
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
      result={
        result
          ? { content: <TasksImportResult result={result} L={L} />, doneLabel: L.importDone }
          : null
      }
      onClose={onClose}
      onImport={onImport}
    />
  );
}
