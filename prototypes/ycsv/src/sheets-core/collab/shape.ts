import * as Y from "yjs";
import { docToText, parseBook, bookToDoc, type ParsedBook } from "../model/file";
import { SHEET_ORDER, SHEETS } from "../model/workbook";

/**
 * The workbook as a document shape of the shared collab session (spike 5's seam,
 * `packages/apps/src/lib/collab/collab-document-shape.ts`), on the integration layout.
 *
 * Roots: `sheets` (Y.Map), `sheetOrder` (Y.Array), `book` (Y.Map). The file text is the
 * canonical multi-sheet YCSV the server stores as the document half; the Yjs state is the
 * sidecar.
 */
export const YCSV_SHAPE_ID = "ycsv";

/** Bump when the seed would build different items from the same text. v2 = workbook layout. */
export const YCSV_SEED_VERSION = "2";

/** cyrb53 (spike 5): 53 bits, so row ids of a 100k-row seed do not collide. */
export function hash53(text: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export function ycsvSeedClientId(text: string, salt?: string): number {
  const key = `${YCSV_SEED_VERSION}\u0000ycsv\u0000${text}${salt === undefined ? "" : `\u0000${salt}`}`;
  return (hash53(key) % 0xfffffffe) + 1;
}

const length = (doc: Y.Doc, name: string, kind: "array" | "map"): number => {
  if (!doc.share.has(name)) return 0;
  return kind === "array" ? doc.getArray(name).length : doc.getMap(name).size;
};

export function recognisesYcsv(doc: Y.Doc): boolean {
  return doc.share.has(SHEETS) && doc.share.has(SHEET_ORDER);
}

/** No sheets. Never creates a shared type. */
export function isYcsvEmpty(doc: Y.Doc): boolean {
  return length(doc, SHEETS, "map") === 0 && length(doc, SHEET_ORDER, "array") === 0;
}

export function readYcsv(doc: Y.Doc): string {
  if (isYcsvEmpty(doc)) return "";
  return docToText(doc);
}

/** Text the parser refuses becomes one text column, one row per line: nothing is lost (spike 5). */
function parseOrFallback(text: string): ParsedBook {
  try {
    return parseBook(text);
  } catch {
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    if (lines.at(-1) === "") lines.pop();
    return {
      book: { ycsv_version: 1 },
      sheets: [{ ref: "sheet1", meta: {}, file: { frontmatter: {}, columns: [{ ref: "text", type: "string" }], header: ["text"], rows: lines.map((line) => [line]) } }],
    };
  }
}

/**
 * Deterministic seed (spike 5): a throwaway doc whose client id and sheet/row/column ids come
 * from the text (+ salt), so two clients seeding one file produce byte-identical updates.
 * Column ids are `c` + base36 index (short, spike 4); row ids hash to 11 base36 chars.
 */
export function buildYcsvSeed(text: string, salt?: string): Uint8Array {
  const scratch = new Y.Doc();
  scratch.clientID = ycsvSeedClientId(text, salt);
  if (text.trim() !== "") {
    const digest = `${hash53(text, 1).toString(36)}.${hash53(text, 2).toString(36)}`;
    const base = `${YCSV_SEED_VERSION}\u0000${digest}\u0000${salt ?? ""}`;
    const id = (kind: string, a: number, b = 0) => hash53(`${base}\u0000${kind}\u0000${a}\u0000${b}`).toString(36).padStart(11, "0");
    bookToDoc(parseOrFallback(text), scratch, {
      sheetId: (s) => `s_${id("sheet", s).slice(0, 8)}`,
      rowId: (s, r) => `r_${id("row", s, r)}`,
      colId: (_s, c) => `c${c.toString(36)}`,
      origin: "seed",
    });
  }
  const update = Y.encodeStateAsUpdate(scratch);
  scratch.destroy();
  return update;
}

export function seedYcsv(target: Y.Doc, text: string, { origin, salt }: { origin: unknown; salt?: string }): void {
  Y.applyUpdate(target, buildYcsvSeed(text, salt), origin);
}
