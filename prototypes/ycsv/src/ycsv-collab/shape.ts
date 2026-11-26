import * as Y from "yjs";
import { parse } from "../ycsv-core/parse";
import { serialize } from "../ycsv-core/serialize";
import type { YcsvFile } from "../ycsv-core/types";
import { docToFile, fileToDoc } from "../ycsv-model/doc";

/**
 * The YCSV document shape for the shared collab session (spike 5).
 *
 * Roots: `columns` (Y.Array<Y.Map>), `rows` (Y.Array<Y.Map{rowId, cells}>),
 * `meta` and `raw` (Y.Map). The file text is the canonical YCSV the server
 * stores as the document half; the Yjs state is the sidecar.
 */
export const YCSV_SHAPE_ID = "ycsv";

/** Bump when the seed would build different items from the same text. */
export const YCSV_SEED_VERSION = "1";

const ROOTS = ["columns", "rows"] as const;

/** cyrb53: 53 bits, so row ids of a 100k-row seed do not collide (32 bits would). */
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

/** A Yjs client id (uint32, non-zero) for the seed of `text`. */
export function ycsvSeedClientId(text: string, salt?: string): number {
  const key = `${YCSV_SEED_VERSION}\u0000ycsv\u0000${text}${salt === undefined ? "" : `\u0000${salt}`}`;
  return (hash53(key) % 0xfffffffe) + 1;
}

function arrayLength(doc: Y.Doc, name: string): number {
  return doc.share.has(name) ? doc.getArray(name).length : 0;
}

export function recognisesYcsv(doc: Y.Doc): boolean {
  return ROOTS.every((name) => doc.share.has(name));
}

/** No columns and no rows. Never creates a shared type. */
export function isYcsvEmpty(doc: Y.Doc): boolean {
  return arrayLength(doc, "columns") === 0 && arrayLength(doc, "rows") === 0;
}

/** The canonical file text (the document half of a save). */
export function readYcsv(doc: Y.Doc): string {
  if (isYcsvEmpty(doc)) return "";
  return serialize(docToFile(doc));
}

/** Text the parser refuses becomes one text column, one row per line: nothing is lost. */
function parseOrFallback(text: string): YcsvFile {
  try {
    return parse(text);
  } catch {
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    if (lines.at(-1) === "") lines.pop();
    return {
      frontmatter: { ycsv_version: 1 },
      columns: [{ ref: "text", type: "string" }],
      header: ["text"],
      rows: lines.map((line) => [line]),
    };
  }
}

/**
 * The deterministic seed: a throwaway doc whose client id and row/column ids
 * come from the text (and `salt`), so two clients seeding the same file text
 * produce byte-identical updates and merging them is a no-op.
 */
export function buildYcsvSeed(text: string, salt?: string): Uint8Array {
  const scratch = new Y.Doc();
  scratch.clientID = ycsvSeedClientId(text, salt);
  if (text.trim() !== "") {
    // Hash the text once; ids then cost O(1) each (hashing the text per row is quadratic).
    const digest = `${hash53(text, 1).toString(36)}.${hash53(text, 2).toString(36)}`;
    const base = `${YCSV_SEED_VERSION}\u0000${digest}\u0000${salt ?? ""}`;
    const id = (kind: string, index: number) =>
      hash53(`${base}\u0000${kind}\u0000${index}`).toString(36).padStart(11, "0");
    fileToDoc(parseOrFallback(text), scratch, {
      rowId: (index) => `r_${id("row", index)}`,
      colId: (index) => `c_${id("col", index)}`,
      origin: "seed",
    });
  }
  // An empty text seeds nothing: no items means no roots, so an empty sheet is
  // known by its session's mark (markCollabShapeDoc), not by its bytes.
  const update = Y.encodeStateAsUpdate(scratch);
  scratch.destroy();
  return update;
}

export function seedYcsv(
  target: Y.Doc,
  text: string,
  { origin, salt }: { origin: unknown; salt?: string },
): void {
  Y.applyUpdate(target, buildYcsvSeed(text, salt), origin);
}
