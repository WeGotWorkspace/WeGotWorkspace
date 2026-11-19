import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
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
  headerClassName?: string;
  cellClassName?: string;
};

type DataTableProps<T> = {
  data: T[];
  columns: DataTableColumn<T>[];
  rowKey: (row: T) => string;
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
            <TableHead key={column.key} className={cn(columnClass(column), column.headerClassName)}>
              {column.header}
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
