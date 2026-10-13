import YAML from "yaml";
import { parseCsv } from "./csv";
import type { ColumnDef, YcsvFile } from "./types";

function columnLetter(index: number): string {
  let n = index + 1;
  let label = "";
  while (n > 0) {
    n -= 1;
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26);
  }
  return label;
}

export function parse(text: string): YcsvFile {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    throw new Error("YCSV: missing frontmatter");
  }

  const lines = normalized.split("\n");
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i] === "---") {
      end = i;
      break;
    }
  }
  if (end === -1) throw new Error("YCSV: unterminated frontmatter");

  const yamlText = lines.slice(1, end).join("\n");
  const bodyText = lines.slice(end + 1).join("\n");
  const parsed = YAML.parse(yamlText) as Record<string, unknown> | null | undefined;
  const frontmatter: Record<string, unknown> = parsed ?? {};

  if (bodyText.includes("\n---\n")) {
    throw new Error("YCSV: multi-sheet not supported in prototype");
  }

  const table = parseCsv(bodyText);
  const header = table[0] ?? [];
  const columns: ColumnDef[] = Array.isArray(frontmatter.columns)
    ? (frontmatter.columns as ColumnDef[])
    : [];

  for (let i = 0; i < columns.length; i += 1) {
    const column = columns[i];
    if (column && (column.ref === undefined || column.ref === "")) {
      column.ref = columnLetter(i);
    }
  }
  if (Array.isArray(frontmatter.columns)) frontmatter.columns = columns;

  if (columns.length > 0 && header.length !== columns.length) {
    throw new Error(
      `YCSV: header has ${header.length} columns, frontmatter has ${columns.length}`,
    );
  }

  const rows = table.slice(1).map((row) => {
    const next = row.slice(0, header.length);
    while (next.length < header.length) next.push("");
    return next;
  });

  return { frontmatter, columns, header, rows };
}
