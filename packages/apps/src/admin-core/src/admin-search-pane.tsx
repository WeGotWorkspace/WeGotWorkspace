import { useMemo, useState } from "react";
import { DatabaseZap, Loader2, ScrollText, StopCircle } from "lucide-react";
import { Button } from "@/button/src/button";
import { FieldLabelRow } from "@/ui/field-label-row";
import { WorkspacePageSection } from "@/workspace-shell/src/workspace-page";
import { DataTable, type DataTableColumn } from "@/data-table/src/data-table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog";
import {
  parseUpdateLogLine,
  formatHumanDateTime,
  type UpdateLogRow,
} from "@/admin-core/src/admin-workspace-utils";
import type { AdminControllerState } from "@/admin-core/src/use-admin-controller";

export function AdminSearchPane({ controller }: { controller: AdminControllerState }) {
  const [confirmReindexOpen, setConfirmReindexOpen] = useState(false);
  const [runningAction, setRunningAction] = useState(false);

  const rows = useMemo(
    () =>
      controller.searchReindex.logLines
        .map((line, index) => parseUpdateLogLine(line, index))
        .slice(-25),
    [controller.searchReindex.logLines],
  );
  const logColumns: DataTableColumn<UpdateLogRow>[] = useMemo(
    () => [
      {
        key: "time",
        header: "Date",
        muted: true,
        shrink: true,
        render: (row) => formatHumanDateTime(row.date),
      },
      {
        key: "message",
        header: "Message",
        cellClassName: "whitespace-normal",
        render: (row) => row.message,
      },
    ],
    [],
  );

  const progress = controller.searchReindex.phaseProgress;
  const progressPercent = progress ? Math.max(2, Math.min(100, progress.percent)) : 0;

  const reindex = controller.searchReindex;
  const statusLine = reindex.inProgress
    ? `Rebuilding: ${(reindex.phase ?? "starting").replace(/_/g, " ")}.`
    : (reindex.lastResult?.message ?? "Rebuild it when search misses things you know are there.");

  return (
    <>
      <WorkspacePageSection
        title="Index"
        icon={<DatabaseZap aria-hidden />}
        action={
          <Button
            type="button"
            variant="ghost"
            className="-me-3"
            label="Refresh"
            aria-label="Refresh state"
            onClick={controller.actions.refreshSearchReindexState}
          />
        }
      >
        <FieldLabelRow
          layout="inline"
          label="Rebuild the index"
          description={statusLine}
          below={
            progress ? (
              <div className="admin-updates-progress-card">
                <div className="admin-updates-progress-head">
                  <div className="admin-updates-stat-label--strong">Progress</div>
                  <div className="admin-updates-progress-count">
                    {`${Math.min(progress.completed, progress.total)} / ${progress.total}`}
                  </div>
                </div>
                <div className="admin-updates-progress-track">
                  <div
                    className="admin-updates-progress-fill"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            ) : undefined
          }
        >
          {reindex.inProgress ? (
            <Button variant="outline" size="sm" onClick={controller.actions.cancelSearchReindex}>
              <StopCircle className="size-4 mr-2" />
              Cancel
            </Button>
          ) : (
            <Button
              variant="outline"
              severity="danger"
              size="sm"
              onClick={() => setConfirmReindexOpen(true)}
              disabled={runningAction}
            >
              {runningAction ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
              Rebuild
            </Button>
          )}
        </FieldLabelRow>
      </WorkspacePageSection>

      {rows.length > 0 ? (
        <WorkspacePageSection title="Log" icon={<ScrollText aria-hidden />}>
          <DataTable data={rows} columns={logColumns} rowKey={(row) => row.id} />
        </WorkspacePageSection>
      ) : null}

      <AlertDialog open={confirmReindexOpen} onOpenChange={setConfirmReindexOpen}>
        <AlertDialogContent className="admin-dialog-surface">
          <AlertDialogHeader>
            <AlertDialogTitle>Rebuild the search index?</AlertDialogTitle>
            <AlertDialogDescription>
              Rebuilds the index for files, calendars and contacts. It may take a while on larger
              installs.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={runningAction}>Cancel</AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                variant="outline"
                severity="danger"
                disabled={runningAction}
                onClick={async (event) => {
                  event.preventDefault();
                  setRunningAction(true);
                  try {
                    await controller.actions.startSearchReindex();
                  } finally {
                    setRunningAction(false);
                    setConfirmReindexOpen(false);
                  }
                }}
              >
                {runningAction ? "Rebuilding..." : "Rebuild"}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
