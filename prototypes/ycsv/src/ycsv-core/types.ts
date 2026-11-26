export type ColumnDef = {
  ref?: string;
  name?: string;
  type?: ColumnType;
  [k: string]: unknown;
};

export type ColumnType =
  | "string"
  | "number"
  | "currency"
  | "percent"
  | "date"
  | "datetime"
  | "boolean";

export type YcsvFile = {
  frontmatter: Record<string, unknown>;
  columns: ColumnDef[];
  header: string[];
  rows: string[][];
};
