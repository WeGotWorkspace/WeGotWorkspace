import { FUNCTION_NAMES, isFunction, signatureOf, type FnSig } from "./functions";
import type { Range } from "./selection";

/**
 * Formula editing helpers. Everything works on the file form the user types
 * (`=aantal3*prijs`), never on row ids, and tolerates half-typed input.
 */

/** Token colours; the same colour outlines the range on the grid. */
// Brand blue is the selection colour, so formula refs start elsewhere.
export const REF_COLORS = ["#7048e8", "#d6336c", "#2b8a3e", "#e8590c", "#0c8599", "#a61e4d", "#5c940d", "#1c7ed6"];

export type Segment =
  | { kind: "ref"; text: string; start: number; end: number; color: number; target: Range | null }
  | { kind: "fn" | "name" | "num" | "str" | "op" | "ws" | "err" | "text"; text: string; start: number; end: number };

/** Resolves one ident (`prijs`, `prijs3`, `$prijs$3`, `C3`) to a cell; null when it is not a cell ref. */
export type RefResolver = (ident: string) => { r: number; c: number } | null;

const IDENT = /\$?(?:'(?:[^']|'')*'?|[A-Za-z_À-ɏ][A-Za-z0-9_À-ɏ.]*)(?:\$?\d+)?/y;

function lex(src: string): { kind: "ident" | "num" | "str" | "op" | "ws" | "err" | "other"; text: string; start: number }[] {
  const out: { kind: "ident" | "num" | "str" | "op" | "ws" | "err" | "other"; text: string; start: number }[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i] ?? "";
    const start = i;
    if (/\s/.test(ch)) {
      while (i < src.length && /\s/.test(src[i] ?? "")) i += 1;
      out.push({ kind: "ws", text: src.slice(start, i), start });
      continue;
    }
    if (ch === '"') {
      i += 1;
      while (i < src.length) {
        if (src[i] === '"' && src[i + 1] === '"') i += 2;
        else if (src[i] === '"') {
          i += 1;
          break;
        } else i += 1;
      }
      out.push({ kind: "str", text: src.slice(start, i), start });
      continue;
    }
    if (src.startsWith("#REF!", i)) {
      i += 5;
      out.push({ kind: "err", text: "#REF!", start });
      continue;
    }
    const num = /\d+(\.\d+)?|\.\d+/y;
    num.lastIndex = i;
    const n = num.exec(src);
    if (n && n.index === i) {
      i += n[0].length;
      out.push({ kind: "num", text: n[0], start });
      continue;
    }
    IDENT.lastIndex = i;
    const id = IDENT.exec(src);
    if (id && id.index === i && id[0] !== "$") {
      i += id[0].length;
      out.push({ kind: "ident", text: id[0], start });
      continue;
    }
    i += 1;
    out.push({ kind: "+-*/^%=<>:,()&".includes(ch) ? "op" : "other", text: ch, start });
  }
  return out;
}

function rangeOf(a: { r: number; c: number }, b: { r: number; c: number }): Range {
  return { r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) };
}

/** Splits a draft into coloured segments; refs to the same cells share a colour. */
export function segments(draft: string, resolve: RefResolver): Segment[] {
  if (!draft.startsWith("=")) return [{ kind: "text", text: draft, start: 0, end: draft.length }];
  const tokens = lex(draft.slice(1)).map((t) => ({ ...t, start: t.start + 1 }));
  const out: Segment[] = [{ kind: "op", text: "=", start: 0, end: 1 }];
  const colorOf = new Map<string, number>();
  const colorFor = (key: string) => {
    if (!colorOf.has(key)) colorOf.set(key, colorOf.size % REF_COLORS.length);
    return colorOf.get(key) ?? 0;
  };
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (!t) continue;
    const end = t.start + t.text.length;
    if (t.kind !== "ident") {
      out.push({ kind: t.kind === "other" ? "text" : t.kind, text: t.text, start: t.start, end });
      continue;
    }
    const nextNonWs = tokens.slice(i + 1).find((x) => x.kind !== "ws");
    if (nextNonWs?.text === "(") {
      out.push({ kind: isFunction(t.text) ? "fn" : "err", text: t.text, start: t.start, end });
      continue;
    }
    const a = resolve(t.text);
    if (!a) {
      out.push({ kind: "name", text: t.text, start: t.start, end });
      continue;
    }
    // A range is ident ":" ident.
    const colon = tokens[i + 1];
    const right = tokens[i + 2];
    if (colon?.text === ":" && right?.kind === "ident") {
      const b = resolve(right.text);
      if (b) {
        const text = draft.slice(t.start, right.start + right.text.length);
        const target = rangeOf(a, b);
        out.push({ kind: "ref", text, start: t.start, end: right.start + right.text.length, color: colorFor(text.replaceAll("$", "").toLowerCase()), target });
        i += 2;
        continue;
      }
    }
    out.push({ kind: "ref", text: t.text, start: t.start, end, color: colorFor(t.text.replaceAll("$", "").toLowerCase()), target: rangeOf(a, a) });
  }
  return out;
}

export function refHighlights(segs: Segment[]): { range: Range; color: number }[] {
  const out: { range: Range; color: number }[] = [];
  for (const seg of segs) if (seg.kind === "ref" && seg.target) out.push({ range: seg.target, color: seg.color });
  return out;
}

/**
 * Whether a click or arrow key should insert a reference rather than leave the
 * editor: the caret sits where an operand is expected (after `=`, an operator, `(`
 * or `,`), or right after a reference that pointing just inserted.
 */
export function wantsRef(draft: string, caret: number, pickedLen: number): boolean {
  if (!draft.startsWith("=")) return false;
  if (pickedLen > 0) return true;
  const before = draft.slice(0, caret).trimEnd();
  return /[=+\-*/^%&,(:<>]$/.test(before);
}

/** File-form text for a picked cell or range. Same-row picks use the bare column name. */
export function refText(
  range: Range,
  editRow: number,
  colRef: (c: number) => string,
): string {
  const cell = (r: number, c: number) => `${colRef(c)}${r + 1}`;
  if (range.r1 === range.r2 && range.c1 === range.c2) {
    return range.r1 === editRow ? colRef(range.c1) : cell(range.r1, range.c1);
  }
  return `${cell(range.r1, range.c1)}:${cell(range.r2, range.c2)}`;
}

export function insertAt(draft: string, caret: number, replaceLen: number, text: string): { draft: string; caret: number } {
  const before = draft.slice(0, caret - replaceLen);
  const after = draft.slice(caret);
  return { draft: before + text + after, caret: before.length + text.length };
}

export type Suggestion = { kind: "fn" | "col" | "def"; label: string; insert: string; detail: string };

/** The identifier being typed just before the caret, if any. */
export function tokenBeforeCaret(draft: string, caret: number): string | null {
  if (!draft.startsWith("=")) return null;
  const before = draft.slice(0, caret);
  // Not inside a string.
  if ((before.match(/"/g) ?? []).length % 2 === 1) return null;
  const m = /[A-Za-z_À-ɏ][A-Za-z0-9_À-ɏ.]*$/.exec(before);
  if (!m) return null;
  // A ref with a row number (prijs3) is finished, nothing to complete.
  if (/\d$/.test(m[0])) return null;
  return m[0];
}

export function suggest(
  draft: string,
  caret: number,
  columns: { ref: string; name?: string }[],
  defs: Record<string, unknown>,
): { token: string; items: Suggestion[] } | null {
  const token = tokenBeforeCaret(draft, caret);
  if (!token) return null;
  const lower = token.toLowerCase();
  const items: Suggestion[] = [];
  for (const col of columns) {
    if (col.ref.toLowerCase().startsWith(lower) || (col.name ?? "").toLowerCase().startsWith(lower)) {
      items.push({ kind: "col", label: col.ref, insert: col.ref, detail: col.name && col.name !== col.ref ? `Column · ${col.name}` : "Column" });
    }
  }
  const walk = (obj: Record<string, unknown>, prefix: string) => {
    for (const [key, value] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === "object" && !Array.isArray(value)) walk(value as Record<string, unknown>, path);
      else if (path.toLowerCase().startsWith(lower)) items.push({ kind: "def", label: path, insert: path, detail: `Defined · ${String(value)}` });
    }
  };
  walk(defs, "");
  for (const name of FUNCTION_NAMES) {
    if (items.length >= 8) break;
    if (name.toLowerCase().startsWith(lower)) {
      const sig = signatureOf(name);
      items.push({ kind: "fn", label: name, insert: `${name}(`, detail: sig?.summary ?? "Function" });
    }
  }
  // An exact, complete match needs no popover.
  const visible = items.slice(0, 8);
  if (visible.length === 1 && visible[0]?.kind !== "fn" && visible[0]?.insert === token) return null;
  return visible.length > 0 ? { token, items: visible } : null;
}

/** The innermost open call around the caret and which argument the caret is in. */
export function signatureAt(draft: string, caret: number): { sig: FnSig; arg: number } | null {
  if (!draft.startsWith("=")) return null;
  const before = draft.slice(1, caret);
  const stack: { name: string; arg: number }[] = [];
  let inStr = false;
  for (let i = 0; i < before.length; i += 1) {
    const ch = before[i];
    if (ch === '"') inStr = !inStr;
    if (inStr) continue;
    if (ch === "(") {
      const m = /([A-Za-z_][A-Za-z0-9_.]*)\s*$/.exec(before.slice(0, i));
      stack.push({ name: m?.[1] ?? "", arg: 0 });
    } else if (ch === ")") stack.pop();
    else if (ch === "," && stack.length > 0) {
      const top = stack[stack.length - 1];
      if (top) top.arg += 1;
    }
  }
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const frame = stack[i];
    const sig = frame ? signatureOf(frame.name) : undefined;
    if (sig && frame) return { sig, arg: frame.arg };
  }
  return null;
}
