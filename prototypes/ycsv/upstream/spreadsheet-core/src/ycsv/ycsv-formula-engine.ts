// =============================================================================
// YCSV formula engine — evaluates workbook formulas with @formulajs/formulajs.
//
// Pipeline (spec §8.7, §A.6):
//   1. Build a raw matrix per sheet (header row + data rows).
//   2. resolveFormula() rewrites named refs to A1 refs (+ inlines defs).
//   3. Parse each formula to an AST; collect cell dependencies.
//   4. Topologically sort formula cells; circular refs are an error.
//   5. Evaluate each formula against already-computed values; cross-sheet refs
//      resolve from other sheets' computed matrices.
// =============================================================================

import * as formulajs from "@formulajs/formulajs";
import {
  colIndexFromLetter,
  resolveFormula,
  sheetToMatrix,
  type ParsedWorkbook,
} from "@/spreadsheet-core/src/ycsv/ycsv";

export type ComputedCell = {
  /** Stringified value for display (re-formatted by the grid via formatValue). */
  display: string;
  /** Raw computed value consumed by dependent formulas. */
  value: unknown;
  error: boolean;
};

export type ComputedSheet = ComputedCell[][];

/** Function catalog for autocomplete; aligned with @formulajs/formulajs exports. */
export const FORMULA_FUNCTIONS: { name: string; signature: string; group: string }[] = [
  { name: "SUM", signature: "SUM(range)", group: "Math" },
  { name: "AVERAGE", signature: "AVERAGE(range)", group: "Statistical" },
  { name: "COUNT", signature: "COUNT(range)", group: "Statistical" },
  { name: "COUNTA", signature: "COUNTA(range)", group: "Statistical" },
  { name: "MIN", signature: "MIN(range)", group: "Statistical" },
  { name: "MAX", signature: "MAX(range)", group: "Statistical" },
  { name: "MEDIAN", signature: "MEDIAN(range)", group: "Statistical" },
  { name: "IF", signature: "IF(test, then, else)", group: "Logical" },
  { name: "IFERROR", signature: "IFERROR(value, fallback)", group: "Logical" },
  { name: "AND", signature: "AND(a, b, …)", group: "Logical" },
  { name: "OR", signature: "OR(a, b, …)", group: "Logical" },
  { name: "NOT", signature: "NOT(a)", group: "Logical" },
  { name: "VLOOKUP", signature: "VLOOKUP(value, table, col, [exact])", group: "Lookup" },
  { name: "HLOOKUP", signature: "HLOOKUP(value, table, row, [exact])", group: "Lookup" },
  { name: "INDEX", signature: "INDEX(range, row, [col])", group: "Lookup" },
  { name: "MATCH", signature: "MATCH(value, range, [type])", group: "Lookup" },
  { name: "CONCATENATE", signature: "CONCATENATE(a, b, …)", group: "Text" },
  { name: "LEFT", signature: "LEFT(text, n)", group: "Text" },
  { name: "RIGHT", signature: "RIGHT(text, n)", group: "Text" },
  { name: "MID", signature: "MID(text, start, n)", group: "Text" },
  { name: "LEN", signature: "LEN(text)", group: "Text" },
  { name: "UPPER", signature: "UPPER(text)", group: "Text" },
  { name: "LOWER", signature: "LOWER(text)", group: "Text" },
  { name: "TRIM", signature: "TRIM(text)", group: "Text" },
  { name: "ROUND", signature: "ROUND(num, digits)", group: "Math" },
  { name: "FLOOR", signature: "FLOOR(num, sig)", group: "Math" },
  { name: "CEILING", signature: "CEILING(num, sig)", group: "Math" },
  { name: "ABS", signature: "ABS(num)", group: "Math" },
  { name: "MOD", signature: "MOD(num, divisor)", group: "Math" },
  { name: "POWER", signature: "POWER(base, exp)", group: "Math" },
  { name: "SQRT", signature: "SQRT(num)", group: "Math" },
  { name: "TODAY", signature: "TODAY()", group: "Date" },
  { name: "NOW", signature: "NOW()", group: "Date" },
  { name: "DATE", signature: "DATE(year, month, day)", group: "Date" },
  { name: "YEAR", signature: "YEAR(date)", group: "Date" },
  { name: "MONTH", signature: "MONTH(date)", group: "Date" },
  { name: "DAY", signature: "DAY(date)", group: "Date" },
];

const FORMULA_REGISTRY = formulajs as unknown as Record<string, (...args: unknown[]) => unknown>;

class FormulaError extends Error {}

// =============================================================================
// Tokenizer
// =============================================================================

type Token =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "id"; v: string }
  | { t: "op"; v: string }
  | { t: "(" }
  | { t: ")" }
  | { t: "," }
  | { t: ":" }
  | { t: "!" };

const TWO_CHAR_OPS = new Set(["<>", "<=", ">="]);

function tokenize(formula: string): Token[] {
  const s = formula;
  const tokens: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let value = "";
      while (j < s.length) {
        if (s[j] === '"') {
          if (s[j + 1] === '"') {
            value += '"';
            j += 2;
            continue;
          }
          break;
        }
        value += s[j];
        j++;
      }
      tokens.push({ t: "str", v: value });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(s[i + 1] ?? ""))) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      tokens.push({ t: "num", v: Number(s.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
      tokens.push({ t: "id", v: s.slice(i, j) });
      i = j;
      continue;
    }
    const two = s.slice(i, i + 2);
    if (TWO_CHAR_OPS.has(two)) {
      tokens.push({ t: "op", v: two });
      i += 2;
      continue;
    }
    if (ch === "(") tokens.push({ t: "(" });
    else if (ch === ")") tokens.push({ t: ")" });
    else if (ch === ",") tokens.push({ t: "," });
    else if (ch === ":") tokens.push({ t: ":" });
    else if (ch === "!") tokens.push({ t: "!" });
    else if ("+-*/^%=<>&".includes(ch)) tokens.push({ t: "op", v: ch });
    else throw new FormulaError("#PARSE!");
    i++;
  }
  return tokens;
}

// =============================================================================
// AST
// =============================================================================

type CellRef = { sheet?: string; col: number; row: number };

type Node =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "bool"; v: boolean }
  | { k: "ref"; ref: CellRef }
  | { k: "range"; a: CellRef; b: CellRef }
  | { k: "call"; name: string; args: Node[] }
  | { k: "unary"; op: string; arg: Node }
  | { k: "bin"; op: string; l: Node; r: Node };

const A1_RE = /^([A-Za-z]+)(\d+)$/;

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): Node {
    const node = this.parseComparison();
    if (this.pos < this.tokens.length) throw new FormulaError("#PARSE!");
    return node;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private next(): Token {
    const token = this.tokens[this.pos++];
    if (!token) throw new FormulaError("#PARSE!");
    return token;
  }

  private parseComparison(): Node {
    let left = this.parseAdditive();
    while (this.isOp(["=", "<>", "<", ">", "<=", ">="])) {
      const op = (this.next() as { v: string }).v;
      left = { k: "bin", op, l: left, r: this.parseAdditive() };
    }
    return left;
  }

  private parseAdditive(): Node {
    let left = this.parseTerm();
    while (this.isOp(["+", "-", "&"])) {
      const op = (this.next() as { v: string }).v;
      left = { k: "bin", op, l: left, r: this.parseTerm() };
    }
    return left;
  }

  private parseTerm(): Node {
    let left = this.parsePower();
    while (this.isOp(["*", "/", "%"])) {
      const op = (this.next() as { v: string }).v;
      left = { k: "bin", op, l: left, r: this.parsePower() };
    }
    return left;
  }

  private parsePower(): Node {
    const left = this.parseUnary();
    if (this.isOp(["^"])) {
      this.next();
      return { k: "bin", op: "^", l: left, r: this.parsePower() };
    }
    return left;
  }

  private parseUnary(): Node {
    if (this.isOp(["-", "+"])) {
      const op = (this.next() as { v: string }).v;
      return { k: "unary", op, arg: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Node {
    const token = this.peek();
    if (!token) throw new FormulaError("#PARSE!");
    if (token.t === "num") {
      this.next();
      return { k: "num", v: token.v };
    }
    if (token.t === "str") {
      this.next();
      return { k: "str", v: token.v };
    }
    if (token.t === "(") {
      this.next();
      const inner = this.parseComparison();
      this.expect(")");
      return inner;
    }
    if (token.t === "id") {
      return this.parseIdentifier();
    }
    throw new FormulaError("#PARSE!");
  }

  private parseIdentifier(): Node {
    const id = (this.next() as { v: string }).v;
    const upper = id.toUpperCase();

    if (this.peek()?.t === "(") {
      this.next();
      const args: Node[] = [];
      if (this.peek()?.t !== ")") {
        args.push(this.parseComparison());
        while (this.peek()?.t === ",") {
          this.next();
          args.push(this.parseComparison());
        }
      }
      this.expect(")");
      return { k: "call", name: upper, args };
    }

    if (upper === "TRUE") return { k: "bool", v: true };
    if (upper === "FALSE") return { k: "bool", v: false };

    // Cross-sheet reference: sheet!A1
    let sheet: string | undefined;
    let refToken = id;
    if (this.peek()?.t === "!") {
      this.next();
      const cell = this.next();
      if (cell.t !== "id") throw new FormulaError("#REF!");
      sheet = id;
      refToken = cell.v;
    }

    const match = refToken.match(A1_RE);
    if (!match) throw new FormulaError("#NAME?");
    const start = this.makeRef(sheet, match[1], match[2]);

    if (this.peek()?.t === ":") {
      this.next();
      const endToken = this.next();
      if (endToken.t !== "id") throw new FormulaError("#REF!");
      let endSheet = sheet;
      let endRefToken = endToken.v;
      if (this.peek()?.t === "!") {
        this.next();
        const cell = this.next();
        if (cell.t !== "id") throw new FormulaError("#REF!");
        endSheet = endToken.v;
        endRefToken = cell.v;
      }
      const endMatch = endRefToken.match(A1_RE);
      if (!endMatch) throw new FormulaError("#REF!");
      const end = this.makeRef(endSheet, endMatch[1], endMatch[2]);
      return { k: "range", a: start, b: end };
    }

    return { k: "ref", ref: start };
  }

  private makeRef(sheet: string | undefined, letters: string, rowDigits: string): CellRef {
    return { sheet, col: colIndexFromLetter(letters), row: parseInt(rowDigits, 10) - 1 };
  }

  private isOp(values: string[]): boolean {
    const token = this.peek();
    return token?.t === "op" && values.includes(token.v);
  }

  private expect(t: Token["t"]): void {
    const token = this.next();
    if (token.t !== t) throw new FormulaError("#PARSE!");
  }
}

// =============================================================================
// Value coercion
// =============================================================================

const DATE_EPOCH = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86_400_000;

function isError(value: unknown): boolean {
  return value instanceof Error;
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Date) return Math.round((value.getTime() - DATE_EPOCH) / MS_PER_DAY);
  const n = Number(String(value).replace(/^\((.+)\)$/, "-$1"));
  if (!Number.isFinite(n)) throw new FormulaError("#VALUE!");
  return n;
}

function looseEqual(a: unknown, b: unknown): boolean {
  if (typeof a === "number" || typeof b === "number") {
    try {
      return toNumber(a) === toNumber(b);
    } catch {
      return String(a) === String(b);
    }
  }
  if (typeof a === "boolean" || typeof b === "boolean") return Boolean(a) === Boolean(b);
  return String(a) === String(b);
}

function compare(a: unknown, b: unknown): number {
  const an = Number(a);
  const bn = Number(b);
  if (Number.isFinite(an) && Number.isFinite(bn) && a !== "" && b !== "") {
    return an - bn;
  }
  return String(a).localeCompare(String(b));
}

/** Convert a computed value to its display string. */
function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    const iso = value.toISOString();
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso;
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

// =============================================================================
// Evaluation context
// =============================================================================

type CellLookup = (sheetIndex: number, row: number, col: number) => unknown;

function evaluate(
  node: Node,
  sheetIndex: number,
  sheetByRef: Map<string, number>,
  lookup: CellLookup,
): unknown {
  switch (node.k) {
    case "num":
      return node.v;
    case "str":
      return node.v;
    case "bool":
      return node.v;
    case "ref":
      return resolveRefValue(node.ref, sheetIndex, sheetByRef, lookup);
    case "range":
      return resolveRangeValues(node.a, node.b, sheetIndex, sheetByRef, lookup);
    case "unary": {
      const arg = toNumber(evaluate(node.arg, sheetIndex, sheetByRef, lookup));
      return node.op === "-" ? -arg : arg;
    }
    case "bin":
      return evaluateBinary(node, sheetIndex, sheetByRef, lookup);
    case "call":
      return evaluateCall(node, sheetIndex, sheetByRef, lookup);
    default:
      throw new FormulaError("#PARSE!");
  }
}

function targetSheetIndex(
  ref: CellRef,
  sheetIndex: number,
  sheetByRef: Map<string, number>,
): number {
  if (!ref.sheet) return sheetIndex;
  const idx = sheetByRef.get(ref.sheet.toLowerCase());
  if (idx === undefined) throw new FormulaError("#REF!");
  return idx;
}

function resolveRefValue(
  ref: CellRef,
  sheetIndex: number,
  sheetByRef: Map<string, number>,
  lookup: CellLookup,
): unknown {
  return lookup(targetSheetIndex(ref, sheetIndex, sheetByRef), ref.row, ref.col);
}

function resolveRangeValues(
  a: CellRef,
  b: CellRef,
  sheetIndex: number,
  sheetByRef: Map<string, number>,
  lookup: CellLookup,
): unknown[] {
  const target = targetSheetIndex(a, sheetIndex, sheetByRef);
  const r1 = Math.min(a.row, b.row);
  const r2 = Math.max(a.row, b.row);
  const c1 = Math.min(a.col, b.col);
  const c2 = Math.max(a.col, b.col);
  const values: unknown[] = [];
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      const value = lookup(target, r, c);
      if (value !== null && value !== undefined && value !== "") values.push(value);
    }
  }
  return values;
}

function evaluateBinary(
  node: Extract<Node, { k: "bin" }>,
  sheetIndex: number,
  sheetByRef: Map<string, number>,
  lookup: CellLookup,
): unknown {
  const op = node.op;
  const left = evaluate(node.l, sheetIndex, sheetByRef, lookup);
  const right = evaluate(node.r, sheetIndex, sheetByRef, lookup);
  switch (op) {
    case "+":
      return toNumber(left) + toNumber(right);
    case "-":
      return toNumber(left) - toNumber(right);
    case "*":
      return toNumber(left) * toNumber(right);
    case "/": {
      const divisor = toNumber(right);
      if (divisor === 0) throw new FormulaError("#DIV/0!");
      return toNumber(left) / divisor;
    }
    case "%": {
      const divisor = toNumber(right);
      if (divisor === 0) throw new FormulaError("#DIV/0!");
      return toNumber(left) % divisor;
    }
    case "^":
      return Math.pow(toNumber(left), toNumber(right));
    case "&":
      return displayValue(left) + displayValue(right);
    case "=":
      return looseEqual(left, right);
    case "<>":
      return !looseEqual(left, right);
    case "<":
      return compare(left, right) < 0;
    case ">":
      return compare(left, right) > 0;
    case "<=":
      return compare(left, right) <= 0;
    case ">=":
      return compare(left, right) >= 0;
    default:
      throw new FormulaError("#PARSE!");
  }
}

function evaluateCall(
  node: Extract<Node, { k: "call" }>,
  sheetIndex: number,
  sheetByRef: Map<string, number>,
  lookup: CellLookup,
): unknown {
  const name = node.name;

  // IFERROR must catch errors thrown while evaluating its first argument.
  if (name === "IFERROR") {
    try {
      const value = evaluate(node.args[0], sheetIndex, sheetByRef, lookup);
      if (isError(value)) throw value;
      return value;
    } catch {
      return node.args[1] ? evaluate(node.args[1], sheetIndex, sheetByRef, lookup) : "";
    }
  }

  // IF short-circuits the unused branch.
  if (name === "IF") {
    const test = evaluate(node.args[0], sheetIndex, sheetByRef, lookup);
    const truthy = typeof test === "boolean" ? test : toNumber(test) !== 0;
    const branch = truthy ? node.args[1] : node.args[2];
    return branch === undefined ? truthy : evaluate(branch, sheetIndex, sheetByRef, lookup);
  }

  const args = node.args.map((arg) => evaluate(arg, sheetIndex, sheetByRef, lookup));
  const fn = FORMULA_REGISTRY[name];
  if (typeof fn !== "function") throw new FormulaError("#NAME?");
  const result = fn(...args);
  if (isError(result)) throw result;
  return result;
}

// =============================================================================
// Dependency extraction + topological evaluation
// =============================================================================

type FormulaCell = {
  sheetIndex: number;
  row: number;
  col: number;
  node: Node;
  deps: { sheetIndex: number; row: number; col: number }[];
};

function collectDeps(
  node: Node,
  sheetIndex: number,
  sheetByRef: Map<string, number>,
  out: { sheetIndex: number; row: number; col: number }[],
): void {
  switch (node.k) {
    case "ref": {
      const target = node.ref.sheet ? sheetByRef.get(node.ref.sheet.toLowerCase()) : sheetIndex;
      if (target !== undefined)
        out.push({ sheetIndex: target, row: node.ref.row, col: node.ref.col });
      break;
    }
    case "range": {
      const target = node.a.sheet ? sheetByRef.get(node.a.sheet.toLowerCase()) : sheetIndex;
      if (target !== undefined) {
        const r1 = Math.min(node.a.row, node.b.row);
        const r2 = Math.max(node.a.row, node.b.row);
        const c1 = Math.min(node.a.col, node.b.col);
        const c2 = Math.max(node.a.col, node.b.col);
        for (let r = r1; r <= r2; r++) {
          for (let c = c1; c <= c2; c++) out.push({ sheetIndex: target, row: r, col: c });
        }
      }
      break;
    }
    case "unary":
      collectDeps(node.arg, sheetIndex, sheetByRef, out);
      break;
    case "bin":
      collectDeps(node.l, sheetIndex, sheetByRef, out);
      collectDeps(node.r, sheetIndex, sheetByRef, out);
      break;
    case "call":
      for (const arg of node.args) collectDeps(arg, sheetIndex, sheetByRef, out);
      break;
    default:
      break;
  }
}

function cellKey(sheetIndex: number, row: number, col: number): string {
  return `${sheetIndex}:${row}:${col}`;
}

function coerceDataCell(raw: string): unknown {
  const v = raw.trim();
  if (v === "") return null;
  if (v === "true" || v === "TRUE") return true;
  if (v === "false" || v === "FALSE") return false;
  const numeric = v.replace(/^\((.+)\)$/, "-$1");
  if (/^-?\d+(\.\d+)?$/.test(numeric)) return Number(numeric);
  return raw;
}

/** Evaluate every formula in the workbook; returns one computed matrix per sheet. */
export function evaluateWorkbook(workbook: ParsedWorkbook): ComputedSheet[] {
  const sheetByRef = new Map(workbook.sheets.map((s, i) => [s.ref.toLowerCase(), i]));
  const matrices = workbook.sheets.map((sheet) => sheetToMatrix(sheet));

  const computed: ComputedSheet[] = matrices.map((matrix) =>
    matrix.map((row) =>
      row.map<ComputedCell>((cell) => {
        const raw = cell.value ?? "";
        if (raw.startsWith("=")) return { display: "", value: null, error: false };
        return { display: "", value: coerceDataCell(raw), error: false };
      }),
    ),
  );

  // Parse formula cells + collect dependencies.
  const formulaCells: FormulaCell[] = [];
  const byKey = new Map<string, FormulaCell>();
  workbook.sheets.forEach((sheet, sheetIndex) => {
    const matrix = matrices[sheetIndex];
    for (let r = 0; r < matrix.length; r++) {
      for (let c = 0; c < matrix[r].length; c++) {
        const raw = matrix[r][c].value ?? "";
        if (!raw.startsWith("=")) continue;
        try {
          const resolved = resolveFormula(raw, sheet, workbook).slice(1);
          const node = new Parser(tokenize(resolved)).parse();
          const deps: FormulaCell["deps"] = [];
          collectDeps(node, sheetIndex, sheetByRef, deps);
          const formulaCell: FormulaCell = { sheetIndex, row: r, col: c, node, deps };
          formulaCells.push(formulaCell);
          byKey.set(cellKey(sheetIndex, r, c), formulaCell);
        } catch {
          computed[sheetIndex][r][c] = {
            display: "#PARSE!",
            value: new Error("#PARSE!"),
            error: true,
          };
        }
      }
    }
  });

  // Topological sort (Kahn) over formula→formula dependencies; cycles are errors.
  const order = topologicalOrder(formulaCells, byKey);

  const lookup: CellLookup = (sheetIndex, row, col) =>
    computed[sheetIndex]?.[row]?.[col]?.value ?? null;

  for (const cell of order.sorted) {
    try {
      const value = evaluate(cell.node, cell.sheetIndex, sheetByRef, lookup);
      computed[cell.sheetIndex][cell.row][cell.col] = {
        display: displayValue(value),
        value,
        error: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message || "#ERROR!" : "#ERROR!";
      computed[cell.sheetIndex][cell.row][cell.col] = {
        display: message,
        value: error instanceof Error ? error : new Error(message),
        error: true,
      };
    }
  }

  for (const cell of order.circular) {
    computed[cell.sheetIndex][cell.row][cell.col] = {
      display: "#CIRCULAR!",
      value: new Error("#CIRCULAR!"),
      error: true,
    };
  }

  return computed;
}

function topologicalOrder(
  formulaCells: FormulaCell[],
  byKey: Map<string, FormulaCell>,
): { sorted: FormulaCell[]; circular: FormulaCell[] } {
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  const keyOf = (c: FormulaCell) => cellKey(c.sheetIndex, c.row, c.col);

  for (const cell of formulaCells) indegree.set(keyOf(cell), 0);

  for (const cell of formulaCells) {
    const key = keyOf(cell);
    const seen = new Set<string>();
    for (const dep of cell.deps) {
      const depKey = cellKey(dep.sheetIndex, dep.row, dep.col);
      if (!byKey.has(depKey) || depKey === key || seen.has(depKey)) continue;
      seen.add(depKey);
      indegree.set(key, (indegree.get(key) ?? 0) + 1);
      const list = dependents.get(depKey) ?? [];
      list.push(key);
      dependents.set(depKey, list);
    }
  }

  const queue: string[] = [];
  for (const [key, degree] of indegree) if (degree === 0) queue.push(key);

  const sorted: FormulaCell[] = [];
  while (queue.length) {
    const key = queue.shift()!;
    const cell = byKey.get(key);
    if (cell) sorted.push(cell);
    for (const dependent of dependents.get(key) ?? []) {
      const next = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, next);
      if (next === 0) queue.push(dependent);
    }
  }

  const sortedKeys = new Set(sorted.map(keyOf));
  const circular = formulaCells.filter((cell) => !sortedKeys.has(keyOf(cell)));
  return { sorted, circular };
}
