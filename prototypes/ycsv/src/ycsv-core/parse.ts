import YAML from "yaml";
import { parseCsv } from "./csv";
import type { ColumnDef, YcsvFile } from "./types";

export function headerLooksNumeric(value: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(value.trim());
}

function usableHeader(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  return value;
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
  let columns: ColumnDef[];
  if (!Array.isArray(frontmatter.columns)) {
    // Header-only refs stay on YcsvFile.columns. Writing them into
    // frontmatter.columns would add a columns block and break byte identity.
    columns = header.map((cell) => {
      const ref = usableHeader(cell);
      return ref === undefined ? {} : { ref };
    });
  } else {
    columns = frontmatter.columns as ColumnDef[];
    for (let i = 0; i < columns.length; i += 1) {
      const column = columns[i];
      if (!column) continue;
      if (typeof column.ref === "string") {
        if (column.ref.trim() === "") throw new Error("YCSV: invalid column ref");
      } else {
        const ref = usableHeader(header[i]);
        if (ref === undefined) delete column.ref;
        else column.ref = ref;
      }
    }
    frontmatter.columns = columns;
  }

  const seen = new Set<string>();
  for (const column of columns) {
    const ref = column.ref;
    if (typeof ref !== "string" || ref === "") continue;
    if (seen.has(ref)) throw new Error(`YCSV: duplicate column ref "${ref}"`);
    seen.add(ref);
  }

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
