import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The committed `.docx` fixtures, built by `build-docx-fixtures.mjs` in this folder. */
export type DocxFixtureName =
  | "headings.docx"
  | "lists.docx"
  | "table.docx"
  | "image-link.docx"
  | "report.docx"
  | "google-export.docx";

export function readDocxFixture(name: DocxFixtureName): Uint8Array {
  return new Uint8Array(readFileSync(join(__dirname, name)));
}
