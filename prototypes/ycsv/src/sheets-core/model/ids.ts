import { customAlphabet } from "nanoid";

const rowGen = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 10);
const shortGen = customAlphabet("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz", 3);
const sheetGen = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

export const newRowId = (): string => `r_${rowGen()}`;
export const newSheetId = (): string => `s_${sheetGen()}`;

/**
 * Short column ids (spike 4: ≤ 4 chars saves ~25% of the sidecar, the id is stored once per
 * cell). Unique within the sheet; a concurrent insert of the same random id by two peers is
 * a 1 in 238k chance per pair of inserts and is not handled.
 */
export function newColId(taken: { has(id: string): boolean }): string {
  for (;;) {
    const id = `c${shortGen()}`;
    if (!taken.has(id)) return id;
  }
}
