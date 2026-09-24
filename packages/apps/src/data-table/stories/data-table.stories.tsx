import type { Meta, StoryObj } from "@storybook/react-vite";
import { Download, FileArchive, Trash2 } from "lucide-react";
import { DataTable, type DataTableColumn } from "../src/data-table";

type BackupRow = {
  id: string;
  filename: string;
  createdAt: string;
  version: string;
  size: string;
};

const rows: BackupRow[] = [
  {
    id: "b1",
    filename: "db-backup-2026-05-04.zip",
    createdAt: "2026-05-04 03:00",
    version: "v2.4.1",
    size: "184 MB",
  },
  {
    id: "b2",
    filename: "db-backup-2026-05-03.zip",
    createdAt: "2026-05-03 03:00",
    version: "v2.4.1",
    size: "182 MB",
  },
];

const columns: DataTableColumn<BackupRow>[] = [
  {
    key: "file",
    header: "File",
    headerClassName: "font-medium pb-3 pr-3",
    cellClassName: "py-3 pr-3",
    render: (row) => (
      <div className="flex items-center gap-2 min-w-0">
        <FileArchive className="size-4 shrink-0 opacity-60" />
        <span className="truncate font-medium">{row.filename}</span>
      </div>
    ),
  },
  {
    key: "createdAt",
    header: "Created",
    headerClassName: "font-medium pb-3 pr-3",
    cellClassName: "py-3 pr-3 whitespace-nowrap",
    render: (row) => (
      <span style={{ color: "color-mix(in oklab, #1a1a18 65%, transparent)" }}>
        {row.createdAt}
      </span>
    ),
  },
  {
    key: "version",
    header: "Version",
    headerClassName: "font-medium pb-3 pr-3",
    cellClassName: "py-3 pr-3 whitespace-nowrap",
    render: (row) => (
      <span
        className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium"
        style={{
          backgroundColor: "color-mix(in oklab, #1a1a18 8%, transparent)",
          color: "#1a1a18",
        }}
      >
        {row.version}
      </span>
    ),
  },
  {
    key: "size",
    header: "Size",
    headerClassName: "font-medium pb-3 pr-3",
    cellClassName: "py-3 pr-3 whitespace-nowrap",
    render: (row) => (
      <span style={{ color: "color-mix(in oklab, #1a1a18 65%, transparent)" }}>{row.size}</span>
    ),
  },
  {
    key: "actions",
    header: "",
    headerClassName: "font-medium pb-3 w-1",
    cellClassName: "py-3 whitespace-nowrap",
    render: (row) => (
      <div className="flex items-center gap-1 justify-end">
        <button
          type="button"
          aria-label={`Download ${row.filename}`}
          className="size-8 rounded-md flex items-center justify-center hover:bg-[color-mix(in_oklab,#1a1a18_8%,transparent)]"
        >
          <Download className="size-4" />
        </button>
        <button
          type="button"
          aria-label={`Delete ${row.filename}`}
          className="size-8 rounded-md flex items-center justify-center hover:bg-[color-mix(in_oklab,#1a1a18_8%,transparent)]"
        >
          <Trash2 className="size-4" />
        </button>
      </div>
    ),
  },
];

const meta: Meta<typeof DataTable<BackupRow>> = {
  title: "UI/Patterns/Data Table",
  component: DataTable<BackupRow>,
};

export default meta;
type Story = StoryObj<typeof DataTable<BackupRow>>;

export const BackupsLike: Story = {
  render: () => (
    <DataTable
      data={rows}
      columns={columns}
      rowKey={(row) => row.id}
      tableClassName="text-sm"
      headerClassName="text-left text-[10px] uppercase tracking-[0.18em]"
      rowClassName="border-t hover:bg-transparent"
      rowStyle={() => ({ borderColor: "color-mix(in oklab, #1a1a18 10%, transparent)" })}
    />
  ),
};
