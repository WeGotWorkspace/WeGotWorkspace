import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getTask } from "@/lib/api/wgw/tasks";
import { WorkspaceLiveAppShell } from "@/lib/live/workspace-live-app-shell";
import {
  resolveTaskConflictFieldMerge,
  resolveTaskConflictKeepLocal,
  resolveTaskConflictUseServer,
} from "@/lib/offline/tasks-conflict-resolution";
import {
  buildTaskConflictFieldRows,
  defaultTaskConflictFieldChoices,
  type TaskConflictFieldChoices,
  type TaskConflictFieldRow,
} from "@/lib/offline/tasks-conflict-merge";
import { listOutboxMutations } from "@/lib/offline/core/outbox-store";
import { tasksOutboxTaskId } from "@/lib/offline/tasks-offline-store";
import { defaultTasksLabels } from "@/tasks-core/src/tasks-labels";
import type { TasksApiSource } from "@/tasks-core/src/tasks-api-source";
import { TasksConflictDialog } from "@/tasks-core/src/tasks-conflict-dialog";
import type { Task } from "@/tasks-core/src/tasks-types";
import { TasksWorkspace } from "@/tasks-core/src/tasks-workspace";
import { useTasksAPI } from "@/tasks-core/src/use-tasks-api";
import { useTasksRouteSync } from "@/tasks-core/src/use-tasks-route-sync";

export type TasksAppProps = {
  apiSource?: TasksApiSource;
};

type ConflictMergeContext = {
  fieldRows: TaskConflictFieldRow[];
  fieldChoices: TaskConflictFieldChoices;
};

export function TasksApp({ apiSource }: TasksAppProps = {}) {
  const { initialView, initialTaskId, handleViewChange } = useTasksRouteSync();
  const tasksRef = useRef<Task[]>([]);

  const [conflictQueue, setConflictQueue] = useState<string[]>([]);
  const [resolvingConflict, setResolvingConflict] = useState(false);
  const [conflictMergeContext, setConflictMergeContext] = useState<ConflictMergeContext | null>(
    null,
  );
  const [conflictMergeLoading, setConflictMergeLoading] = useState(false);

  const handleSyncConflict = useCallback((taskIds: string[]) => {
    setConflictQueue((prev) => {
      const next = [...prev];
      for (const id of taskIds) {
        if (!next.includes(id)) next.push(id);
      }
      return next;
    });
  }, []);

  const {
    phase,
    error,
    retry,
    successVersion,
    bootstrapRevision,
    listRefreshing,
    refreshList,
    data,
    session,
    operations,
    offlineUsername,
  } = useTasksAPI(apiSource, { onSyncConflict: handleSyncConflict });

  tasksRef.current = data.tasks;

  const activeConflictId = conflictQueue[0] ?? null;
  const activeConflictTask = activeConflictId
    ? tasksRef.current.find((task) => task.id === activeConflictId)
    : undefined;
  const activeConflictTitle = activeConflictTask?.title?.trim() || defaultTasksLabels.untitledTask;

  const dismissActiveConflict = useCallback(() => {
    setConflictQueue((prev) => prev.slice(1));
    setConflictMergeContext(null);
  }, []);

  const finishConflictResolution = useCallback(
    (task: () => Promise<unknown>) => {
      if (!activeConflictId || !offlineUsername) {
        dismissActiveConflict();
        return;
      }
      setResolvingConflict(true);
      void (async () => {
        try {
          await task();
        } catch {
          // Resolution best-effort; refresh below re-reads latest state.
        } finally {
          setResolvingConflict(false);
          dismissActiveConflict();
          refreshList();
        }
      })();
    },
    [activeConflictId, offlineUsername, dismissActiveConflict, refreshList],
  );

  const resolveActiveConflictKeepLocal = useCallback(() => {
    finishConflictResolution(() =>
      resolveTaskConflictKeepLocal(offlineUsername!, activeConflictId!),
    );
  }, [finishConflictResolution, offlineUsername, activeConflictId]);

  const resolveActiveConflictUseServer = useCallback(() => {
    finishConflictResolution(() =>
      resolveTaskConflictUseServer(offlineUsername!, activeConflictId!),
    );
  }, [finishConflictResolution, offlineUsername, activeConflictId]);

  const handleFieldChoicesChange = useCallback((choices: TaskConflictFieldChoices) => {
    setConflictMergeContext((prev) => (prev ? { ...prev, fieldChoices: choices } : prev));
  }, []);

  const resolveActiveConflictFieldMerge = useCallback(
    (choices: TaskConflictFieldChoices) => {
      if (!activeConflictTask) {
        dismissActiveConflict();
        return;
      }
      finishConflictResolution(() =>
        resolveTaskConflictFieldMerge(
          offlineUsername!,
          activeConflictId!,
          activeConflictTask,
          choices,
        ),
      );
    },
    [
      activeConflictTask,
      finishConflictResolution,
      offlineUsername,
      activeConflictId,
      dismissActiveConflict,
    ],
  );

  useEffect(() => {
    if (!activeConflictId || !offlineUsername || !activeConflictTask) {
      setConflictMergeContext(null);
      setConflictMergeLoading(false);
      return;
    }

    let cancelled = false;
    setConflictMergeLoading(true);
    setConflictMergeContext(null);

    void (async () => {
      try {
        const rows = await listOutboxMutations(offlineUsername);
        const pending = rows.filter((row) => tasksOutboxTaskId(row) === activeConflictId);
        const hasUpdate = pending.some((row) => row.op === "update");
        if (!hasUpdate) {
          if (!cancelled) setConflictMergeContext(null);
          return;
        }

        const serverTask = await getTask(activeConflictId);
        const fieldRows = buildTaskConflictFieldRows(
          serverTask,
          activeConflictTask,
          defaultTasksLabels,
        );
        if (!cancelled) {
          setConflictMergeContext({
            fieldRows,
            fieldChoices: defaultTaskConflictFieldChoices(fieldRows),
          });
        }
      } catch {
        if (!cancelled) setConflictMergeContext(null);
      } finally {
        if (!cancelled) setConflictMergeLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeConflictId, offlineUsername, activeConflictTask]);

  const fieldMergeMode = useMemo(
    () => Boolean(conflictMergeContext && conflictMergeContext.fieldRows.length > 0),
    [conflictMergeContext],
  );

  const tasksDisabled =
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    (error as Error).message === "TASKS_SETTINGS_MISSING";

  return (
    <>
      <WorkspaceLiveAppShell
        phase={tasksDisabled ? "ready" : phase}
        error={tasksDisabled ? null : error}
        retry={retry}
        errorTitle={defaultTasksLabels.tasksDisabledTitle}
        successVersion={successVersion}
        render={(key) =>
          tasksDisabled ? (
            <div className="flex min-h-dvh items-center justify-center p-8 text-center">
              <div>
                <h1 className="text-lg font-semibold">{defaultTasksLabels.tasksDisabledTitle}</h1>
                <p className="mt-2 text-sm opacity-70">{defaultTasksLabels.tasksDisabledMessage}</p>
              </div>
            </div>
          ) : (
            <TasksWorkspace
              key={key}
              data={data}
              session={session}
              operations={operations}
              listRefreshing={listRefreshing}
              bootstrapRevision={bootstrapRevision}
              onRefreshList={refreshList}
              initialView={initialView}
              initialTaskId={initialTaskId}
              onViewChange={handleViewChange}
              onLogout={() => {
                window.location.assign("/logout");
              }}
            />
          )
        }
      />
      <TasksConflictDialog
        open={activeConflictId !== null && (!conflictMergeLoading || fieldMergeMode)}
        taskTitle={activeConflictTitle}
        remainingCount={Math.max(0, conflictQueue.length - 1)}
        busy={resolvingConflict || conflictMergeLoading}
        labels={defaultTasksLabels}
        fieldRows={conflictMergeContext?.fieldRows}
        fieldChoices={conflictMergeContext?.fieldChoices}
        onFieldChoicesChange={handleFieldChoicesChange}
        onConfirmMerge={resolveActiveConflictFieldMerge}
        onKeepLocal={resolveActiveConflictKeepLocal}
        onUseServer={resolveActiveConflictUseServer}
        onOpenChange={(open) => {
          if (!open && !resolvingConflict && !conflictMergeLoading) dismissActiveConflict();
        }}
      />
    </>
  );
}
