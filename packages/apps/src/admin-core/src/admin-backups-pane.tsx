import { Download, FileArchive, Trash2 } from "lucide-react";
import { Card } from "@/card/src/card";
import { DataTable, type DataTableColumn } from "@/data-table/src/data-table";
import { formatHumanDateTime } from "@/admin-core/src/admin-workspace-utils";
import { IconActionButton } from "@/admin-core/src/admin-workspace-widgets";
import type { AdminControllerState } from "@/admin-core/src/use-admin-controller";

export type AdminBackupsPaneProps = {
  controller: AdminControllerState;
};

export function AdminBackupsPane({ controller }: AdminBackupsPaneProps) {
  const backupColumns: DataTableColumn<(typeof controller.updates.backups)[number]>[] = [
    {
      key: "file",
      header: "File",
      headerClassName: "font-medium pb-3 pr-3",
      cellClassName: "py-3 pr-3",
      render: (row) => (
        <div className="admin-backup-file-row">
          <FileArchive className="admin-backup-file-icon" />
          <span className="truncate font-medium">{row.name}</span>
        </div>
      ),
    },
    {
      key: "created",
      header: "Created",
      headerClassName: "font-medium pb-3 pr-3",
      cellClassName: "py-3 pr-3 whitespace-nowrap",
      render: (row) => (
        <span className="admin-text-muted-65">{formatHumanDateTime(row.modifiedAt)}</span>
      ),
    },
    {
      key: "version",
      header: "Version",
      headerClassName: "font-medium pb-3 pr-3",
      cellClassName: "py-3 pr-3 whitespace-nowrap",
      render: (row) => (
        <span className="admin-backup-version-pill">{row.toVersion ?? row.fromVersion ?? "-"}</span>
      ),
    },
    {
      key: "size",
      header: "Size",
      headerClassName: "font-medium pb-3 pr-3",
      cellClassName: "py-3 pr-3 whitespace-nowrap",
      render: (row) => (
        <span className="admin-text-muted-65">{`${Math.round(row.sizeBytes / 1024 / 1024)} MB`}</span>
      ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      headerClassName: "font-medium pb-3 w-1",
      cellClassName: "py-3 whitespace-nowrap text-right",
      render: (row) => (
        <div className="flex items-center gap-1 justify-end">
          {row.downloadable ? (
            <IconActionButton
              label={`Download ${row.name}`}
              onClick={() => controller.actions.downloadBackup(row.name)}
            >
              <Download className="size-4" />
            </IconActionButton>
          ) : null}
          <IconActionButton
            label={`Delete ${row.name}`}
            onClick={() => controller.actions.deleteBackup(row.name)}
          >
            <Trash2 className="size-4" />
          </IconActionButton>
        </div>
      ),
    },
  ];

  return (
    <Card title="Database backups">
      <DataTable
        data={controller.updates.backups}
        columns={backupColumns}
        rowKey={(row) => row.name}
        className="-mx-6 px-6"
        tableClassName="w-full text-sm"
        headerClassName="admin-table-head"
        rowClassName="admin-data-table-row"
      />
    </Card>
  );
}
