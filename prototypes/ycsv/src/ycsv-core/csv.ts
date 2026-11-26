type CsvState = "FIELD" | "QUOTED" | "QUOTE_IN_QUOTED";

export function parseCsv(text: string): string[][] {
  let state: CsvState = "FIELD";
  let field = "";
  let row: string[] = [];
  const rows: string[][] = [];

  for (const c of text) {
    if (state === "FIELD") {
      if (c === '"' && field === "") state = "QUOTED";
      else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else if (c === "\r") {
        // ignored
      } else field += c;
    } else if (state === "QUOTED") {
      if (c === '"') state = "QUOTE_IN_QUOTED";
      else field += c;
    } else if (c === '"') {
      field += '"';
      state = "QUOTED";
    } else if (c === ",") {
      row.push(field);
      field = "";
      state = "FIELD";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      state = "FIELD";
    } else if (c === "\r") {
      // ignored
    } else {
      field += c;
      state = "FIELD";
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((entry) => !(entry.length === 1 && entry[0] === ""));
}

function escapeField(value: string): string {
  if (/[,"\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

export function serializeCsv(rows: string[][]): string {
  return `${rows.map((row) => row.map(escapeField).join(",")).join("\n")}\n`;
}
