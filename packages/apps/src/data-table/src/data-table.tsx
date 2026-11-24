import type { CSSProperties, ReactNode } from "react";
import { listSortAria, type ListSort, type ListSortDirection } from "@/lib/list-sort";
import { cn } from "@/lib/utils";
import { SortableColumnHeader } from "@/ui/sortable-column-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";

export type DataTableColumn<T> = {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  /** Values line up at the end (sizes, counts, row actions). */
  align?: "start" | "end";
  /** Secondary values (dates, sizes): the list's muted ink. */
  muted?: boolean;
  /** Takes only the room its values need. */
  shrink?: boolean;
  /**
   * Makes the header sort the list (the table needs `sort` and `onSort`; `header` must be a
   * string). `firstDirection` is what a first click gives, as in Drive and Docs.
   */
  sortKey?: string;
  firstDirection?: ListSortDirection;
  headerClassName?: string;
  cellClassName?: string;
};

type DataTableProps<T> = {
  data: T[];
  columns: DataTableColumn<T>[];
  rowKey: (row: T) => string;
  /** The sorted column and direction; the rows come in already sorted. */
  sort?: ListSort;
  onSort?: (key: string) => void;
  /** On the table (it scrolls sideways in its own wrapper when it does not fit). */
  className?: string;
  tableClassName?: string;
  rowClassName?: string | ((row: T) => string | undefined);
  rowStyle?: (row: T) => CSSProperties | undefined;
};

/**
 * A read-only list with columns, in the suite's list look (`ui/list-table.css`, the
 * same rows as Drive and Docs): the sticky head bar, rounded rows, a hairline between.
 */
export function DataTable<T>({
  data,
  columns,
  rowKey,
  sort,
  onSort,
  className,
  tableClassName,
  rowClassName,
  rowStyle,
}: DataTableProps<T>) {
  const columnClass = (column: DataTableColumn<T>) =>
    cn(
      column.align === "end" && "list-table__cell--end",
      column.shrink && "w-px whitespace-nowrap",
    );
  return (
    <Table className={cn(tableClassName, className)}>
      <TableHeader>
        <tr>
          {columns.map((column) => (
            <TableHead
              key={column.key}
              className={cn(columnClass(column), column.headerClassName)}
              aria-sort={column.sortKey && sort ? listSortAria(sort, column.sortKey) : undefined}
            >
              {column.sortKey && sort && onSort && typeof column.header === "string" ? (
                <SortableColumnHeader
                  label={column.header}
                  sortKey={column.sortKey}
                  sort={sort}
                  onSort={onSort}
                  firstDirection={column.firstDirection}
                  align={column.align}
                />
              ) : (
                column.header
              )}
            </TableHead>
          ))}
        </tr>
      </TableHeader>
      <TableBody>
        {data.map((row) => (
          <TableRow
            key={rowKey(row)}
            className={typeof rowClassName === "function" ? rowClassName(row) : rowClassName}
            style={rowStyle ? rowStyle(row) : undefined}
          >
            {columns.map((column) => (
              <TableCell
                key={column.key}
                className={cn(
                  columnClass(column),
                  column.muted && "list-table__muted tabular-nums",
                  column.cellClassName,
                )}
              >
                {column.render(row)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
