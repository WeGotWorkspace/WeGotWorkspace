// Token-highlighted overlay for formula inputs. Renders colored spans behind a
// transparent <input>; widths match exactly because spans carry no padding/margin/
// border and inherit the input font.

import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { FORMULA_FUNCTIONS } from "@/spreadsheet-core/src/ycsv/ycsv-formula-engine";

const FN_NAMES = new Set(FORMULA_FUNCTIONS.map((f) => f.name.toUpperCase()));

export type Tok = {
  type:
    | "fn"
    | "const"
    | "defkey"
    | "ref"
    | "cellref"
    | "sheetref"
    | "string"
    | "number"
    | "op"
    | "ws"
    | "ident";
  text: string;
};

function isSheetRefPart(refPart: string, refs: Set<string>): boolean {
  if (/^[A-Z]+\d+$/.test(refPart)) return true;
  const named = refPart.match(/^([a-z][a-z0-9_]*?)(\d+)$/i);
  if (named && refs.has(named[1].toLowerCase())) return true;
  if (/^[a-z][a-z0-9_]*$/i.test(refPart) && refs.has(refPart.toLowerCase())) return true;
  return false;
}

export function tokenizeFormula(
  s: string,
  consts: Set<string>,
  refs: Set<string>,
  sheetRefs: Set<string> = new Set(),
  /** Column refs per sheet (lowercase sheet ref → lowercase column refs). */
  sheetColumnRefs: Map<string, Set<string>> = new Map(),
  /** Mapping def name → lowercase mapping keys (for `name.key` highlighting). */
  mappingDefs: Map<string, Set<string>> = new Map(),
): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') j++;
      out.push({ type: "string", text: s.slice(i, Math.min(j + 1, s.length)) });
      i = Math.min(j + 1, s.length);
      continue;
    }
    if (/\s/.test(c)) {
      let j = i;
      while (j < s.length && /\s/.test(s[j])) j++;
      out.push({ type: "ws", text: s.slice(i, j) });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(s[i + 1] ?? ""))) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      out.push({ type: "number", text: s.slice(i, j) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
      const word = s.slice(i, j);

      if (j < s.length && s[j] === "!" && sheetRefs.has(word.toLowerCase())) {
        let k = j + 1;
        while (k < s.length && /[A-Za-z0-9_]/.test(s[k])) k++;
        const refPart = s.slice(j + 1, k);
        const targetCols = sheetColumnRefs.get(word.toLowerCase()) ?? refs;
        if (refPart && isSheetRefPart(refPart, targetCols)) {
          out.push({ type: "sheetref", text: s.slice(i, k) });
          i = k;
          continue;
        }
      }

      if (j < s.length && s[j] === "." && mappingDefs.has(word.toLowerCase())) {
        let k = j + 1;
        while (k < s.length && /[A-Za-z0-9_]/.test(s[k])) k++;
        const keyPart = s.slice(j + 1, k);
        out.push({ type: "const", text: word });
        out.push({ type: "op", text: "." });
        if (keyPart) out.push({ type: "defkey", text: keyPart });
        i = k;
        continue;
      }

      const uppRange = /^[A-Z]+\d+$/.test(word);
      const lower = word.match(/^([a-z][a-z0-9_]*?)(\d+)$/);
      if (uppRange) {
        out.push({ type: "cellref", text: word });
        i = j;
        continue;
      }
      if (lower && refs.has(lower[1])) {
        out.push({ type: "ref", text: word });
        i = j;
        continue;
      }
      if (FN_NAMES.has(word.toUpperCase())) out.push({ type: "fn", text: word });
      else if (consts.has(word)) out.push({ type: "const", text: word });
      else if (refs.has(word)) out.push({ type: "ref", text: word });
      else out.push({ type: "ident", text: word });
      i = j;
      continue;
    }
    out.push({ type: "op", text: c });
    i++;
  }
  return out;
}

export function FormulaTokens({
  value,
  consts,
  refs,
  sheetRefs,
  sheetColumnRefs,
  mappingDefs,
  className,
}: {
  value: string;
  consts: Set<string>;
  refs: Set<string>;
  sheetRefs?: Set<string>;
  sheetColumnRefs?: Map<string, Set<string>>;
  mappingDefs?: Map<string, Set<string>>;
  className?: string;
}) {
  if (!value.startsWith("=")) return null;
  const body = value.slice(1);
  const toks = tokenizeFormula(body, consts, refs, sheetRefs, sheetColumnRefs, mappingDefs);
  return (
    <div aria-hidden className={cn("spreadsheet-formula-tokens", className)}>
      <span className="spreadsheet-formula-token spreadsheet-formula-token--fn">=</span>
      {toks.map((t, i) => (
        <span
          key={i}
          className={cn("spreadsheet-formula-token", `spreadsheet-formula-token--${t.type}`)}
        >
          {t.text}
        </span>
      ))}
    </div>
  );
}

/** Keeps the overlay scroll synced with the input scrollLeft. */
export function useScrollSync(
  inputRef: React.RefObject<HTMLInputElement | null>,
  overlayRef: React.RefObject<HTMLDivElement | null>,
) {
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const sync = () => {
      if (overlayRef.current) overlayRef.current.scrollLeft = el.scrollLeft;
    };
    el.addEventListener("scroll", sync);
    return () => el.removeEventListener("scroll", sync);
  }, [inputRef, overlayRef]);
}
