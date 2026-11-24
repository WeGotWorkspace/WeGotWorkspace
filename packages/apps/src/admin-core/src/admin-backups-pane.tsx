import { useMemo, useState } from "react";
import { EllipsisVertical, FileArchive } from "lucide-react";
import { WorkspacePageSection } from "@/workspace-shell/src/workspace-page";
import { Tag } from "@/tag/src/tag";
import { DataTable, type DataTableColumn } from "@/data-table/src/data-table";
import { formatHumanDateTime } from "@/admin-core/src/admin-workspace-utils";
import { Button } from "@/button/src/button";
import { IconButton } from "@/button/src/icon-button";
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
  compareListNumber,
  compareListText,
  nextListSort,
  type ListSort,
  type ListSortDirection,
} from "@/lib/list-sort";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import type { AdminControllerState } from "@/admin-core/src/use-admin-controller";

export type AdminBackupsPaneProps = {
  controller: AdminControllerState;
};

type BackupRow = AdminControllerState["updates"]["backups"][number];
type BackupSortKey = "name" | "version" | "created";

/** What a first click on a column gives: text A→Z, newest and largest first. */
const BACKUP_SORT_FIRST: Readonly<Record<BackupSortKey, ListSortDirection>> = {
  name: "asc",
  version: "desc",
  created: "desc",
};

function backupVersion(row: BackupRow): string {
  return row.toVersion ?? row.fromVersion ?? "";
}

function compareBackups(a: BackupRow, b: BackupRow, sort: ListSort<BackupSortKey>): number {
  const sign = sort.direction === "asc" ? 1 : -1;
  switch (sort.key) {
    case "name":
      return sign * compareListText(a.name, b.name);
    case "version":
      return sign * compareListText(backupVersion(a), backupVersion(b));
    case "created":
      return compareListNumber(
        a.modifiedAt ? Date.parse(a.modifiedAt) : undefined,
        b.modifiedAt ? Date.parse(b.modifiedAt) : undefined,
        sort.direction,
      );
  }
}

export function AdminBackupsPane({ controller }: AdminBackupsPaneProps) {
  const [sort, setSort] = useState<ListSort<BackupSortKey>>({ key: "created", direction: "desc" });
  const [deleting, setDeleting] = useState<string | null>(null);
  const rows = useMemo(
    () => [...controller.updates.backups].sort((a, b) => compareBackups(a, b, sort)),
    [controller.updates.backups, sort],
  );
  const backupColumns: DataTableColumn<BackupRow>[] = [
    {
      key: "name",
      header: "Name",
      sortKey: "name",
      firstDirection: BACKUP_SORT_FIRST.name,
      headerClassName: "w-full sm:w-1/2",
      cellClassName: "max-w-0",
      render: (row) => (
        <span className="list-table__name">
          <FileArchive aria-hidden />
          <span>{row.name}</span>
        </span>
      ),
    },
    {
      key: "version",
      header: "Version",
      sortKey: "version",
      firstDirection: BACKUP_SORT_FIRST.version,
      // Wide enough for the label and the sort arrow, so the label is not cut off.
      headerClassName: "min-w-[6.5rem] sm:w-1/4",
      render: (row) => {
        const version = row.toVersion ?? row.fromVersion;
        return version ? <Tag label={version} /> : null;
      },
    },
    {
      key: "created",
      header: "Created",
      sortKey: "created",
      firstDirection: BACKUP_SORT_FIRST.created,
      // Hidden on phones, as the date columns in Drive and Docs.
      headerClassName: "hidden sm:table-cell",
      cellClassName: "hidden sm:table-cell",
      muted: true,
      render: (row) => formatHumanDateTime(row.modifiedAt),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "end",
      shrink: true,
      render: (row) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              type="button"
              variant="ghost"
              label={`More options: ${row.name}`}
              icon={<EllipsisVertical aria-hidden />}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {row.downloadable ? (
              <DropdownMenuItem onSelect={() => controller.actions.downloadBackup(row.name)}>
                Download
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              className="menu-item--severity-danger menu-item--interactive"
              onSelect={() => setDeleting(row.name)}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  if (controller.updates.backups.length === 0) {
    return (
      <WorkspacePageSection>
        <p className="workspace-page-section__lead">No backups yet</p>
      </WorkspacePageSection>
    );
  }

  return (
    <>
      <WorkspacePageSection>
        <DataTable
          data={rows}
          columns={backupColumns}
          rowKey={(row) => row.name}
          sort={sort}
          onSort={(key) =>
            setSort((current) =>
              nextListSort(current, key as BackupSortKey, BACKUP_SORT_FIRST[key as BackupSortKey]),
            )
          }
        />
      </WorkspacePageSection>
      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent className="admin-dialog-surface">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this backup?</AlertDialogTitle>
            <AlertDialogDescription>
              {`${deleting ?? ""} is deleted for good. This cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                variant="outline"
                severity="danger"
                onClick={() => {
                  const name = deleting;
                  setDeleting(null);
                  if (name) void controller.actions.deleteBackup(name);
                }}
              >
                Delete
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
