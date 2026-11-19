import { Download, FileArchive, Trash2 } from "lucide-react";
import { WorkspacePageSection } from "@/workspace-shell/src/workspace-page";
import { Tag } from "@/tag/src/tag";
import { formatBytesCompact } from "@/lib/files/file-name-utils";
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
      key: "name",
      header: "Name",
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
      shrink: true,
      render: (row) => {
        const version = row.toVersion ?? row.fromVersion;
        return version ? <Tag label={version} /> : null;
      },
    },
    {
      key: "created",
      header: "Created",
      muted: true,
      shrink: true,
      render: (row) => formatHumanDateTime(row.modifiedAt),
    },
    {
      key: "size",
      header: "Size",
      align: "end",
      muted: true,
      shrink: true,
      render: (row) => formatBytesCompact(row.sizeBytes),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "end",
      shrink: true,
      render: (row) => (
        <span className="admin-row-actions">
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
        </span>
      ),
    },
  ];

  if (controller.updates.backups.length === 0) {
    return (
      <WorkspacePageSection>
        <p className="workspace-page-section__lead">
          No backups yet. One is made before every update.
        </p>
      </WorkspacePageSection>
    );
  }

  return (
    <WorkspacePageSection>
      <DataTable
        data={controller.updates.backups}
        columns={backupColumns}
        rowKey={(row) => row.name}
      />
    </WorkspacePageSection>
  );
}
