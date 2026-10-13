import * as formulajs from "@formulajs/formulajs";
import type { Node } from "./ast";

export type CellError = "#SYNTAX" | "#REF" | "#NAME" | "#CYCLE" | "#VALUE" | "#DIV/0";
export type Value = number | string | boolean | CellError;

export type EvalCtx = {
  cell: (col: string, row: string) => Value;
  def: (path: string) => Value | undefined;
  rowOrder: string[];
};

const ERRORS = new Set<string>(["#SYNTAX", "#REF", "#NAME", "#CYCLE", "#VALUE", "#DIV/0"]);

export function isCellError(value: unknown): value is CellError {
  return typeof value === "string" && ERRORS.has(value);
}

type Result = Value | Value[];

function rowsBetween(rowOrder: string[], from: string, to: string): string[] | null {
  const start = rowOrder.indexOf(from);
  const end = rowOrder.indexOf(to);
  if (start < 0 || end < 0) return null;
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  return rowOrder.slice(lo, hi + 1);
}

export function toNumber(value: Value): number | CellError {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value === "") return 0;
  if (isCellError(value)) return value;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return "#VALUE";
}

function isTruthy(value: Value): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return value !== "";
}

function compare(op: string, left: Value, right: Value): Value {
  if (op === "=" || op === "<>") {
    const same =
      typeof left === "number" && typeof right === "number" ? left === right : String(left) === String(right);
    return op === "=" ? same : !same;
  }
  if (typeof left === "string" && typeof right === "string" && !isCellError(left) && !isCellError(right)) {
    const order = left.localeCompare(right);
    if (op === "<") return order < 0;
    if (op === ">") return order > 0;
    if (op === "<=") return order <= 0;
    return order >= 0;
  }
  const ln = toNumber(left);
  const rn = toNumber(right);
  if (isCellError(ln)) return ln;
  if (isCellError(rn)) return rn;
  if (op === "<") return ln < rn;
  if (op === ">") return ln > rn;
  if (op === "<=") return ln <= rn;
  return ln >= rn;
}

function arithmetic(op: string, left: Value, right: Value): Value {
  const ln = toNumber(left);
  const rn = toNumber(right);
  if (isCellError(ln)) return ln;
  if (isCellError(rn)) return rn;
  if ((op === "/" || op === "%") && rn === 0) return "#DIV/0";
  if (op === "+") return ln + rn;
  if (op === "-") return ln - rn;
  if (op === "*") return ln * rn;
  if (op === "/") return ln / rn;
  if (op === "%") return ln % rn;
  return ln ** rn;
}

const functions = formulajs as unknown as Record<string, (...args: unknown[]) => unknown>;

function callFunction(fn: string, args: unknown[]): Value {
  const impl = functions[fn];
  if (typeof impl !== "function") return "#NAME";
  try {
    const result = impl(...args);
    if (result === undefined || (typeof result === "number" && Number.isNaN(result))) return "#VALUE";
    if (result instanceof Error) return "#VALUE";
    if (result instanceof Date) {
      if (fn === "TODAY" || fn === "DATE") return result.toISOString().slice(0, 10);
      return result.toISOString();
    }
    if (typeof result === "number" || typeof result === "string" || typeof result === "boolean") {
      if (isCellError(result)) return result;
      return result;
    }
    return "#VALUE";
  } catch {
    return "#VALUE";
  }
}

function evalAny(node: Node, ctx: EvalCtx): Result {
  switch (node.k) {
    case "num":
    case "str":
      return node.v;
    case "ref":
      return ctx.cell(node.col, node.row);
    case "name":
      if (node.path === "#REF!") return "#REF";
      return ctx.def(node.path) ?? "#NAME";
    case "range": {
      const rows = rowsBetween(ctx.rowOrder, node.from, node.to);
      if (!rows) return "#REF";
      const values: Value[] = [];
      for (const rowId of rows) {
        const value = ctx.cell(node.col, rowId);
        if (isCellError(value)) return value;
        values.push(value);
      }
      return values;
    }
    case "unary": {
      const arg = evalAny(node.arg, ctx);
      if (Array.isArray(arg)) return "#VALUE";
      if (isCellError(arg)) return arg;
      const num = toNumber(arg);
      if (isCellError(num)) return num;
      return -num;
    }
    case "bin": {
      const left = evalAny(node.l, ctx);
      if (Array.isArray(left)) return "#VALUE";
      if (isCellError(left)) return left;
      const right = evalAny(node.r, ctx);
      if (Array.isArray(right)) return "#VALUE";
      if (isCellError(right)) return right;
      if ("+-*/^%".includes(node.op)) return arithmetic(node.op, left, right);
      return compare(node.op, left, right);
    }
    case "call":
      return evalCall(node.fn, node.args, ctx);
    default:
      return "#SYNTAX";
  }
}

function evalCall(fn: string, args: Node[], ctx: EvalCtx): Value {
  if (fn === "IF") {
    const cond = args[0] ? evalAny(args[0], ctx) : "#VALUE";
    if (Array.isArray(cond)) return "#VALUE";
    if (isCellError(cond)) return cond;
    const branch = isTruthy(cond) ? args[1] : args[2];
    if (!branch) return false;
    const chosen = evalAny(branch, ctx);
    if (Array.isArray(chosen)) return "#VALUE";
    return chosen;
  }

  const keepErrors = fn === "ISERROR" || fn === "IFERROR";
  const evaluated: unknown[] = [];
  for (const arg of args) {
    const value = evalAny(arg, ctx);
    if (!Array.isArray(value) && isCellError(value) && !keepErrors) return value;
    evaluated.push(value);
  }
  return callFunction(fn, evaluated);
}

export function evalNode(node: Node, ctx: EvalCtx): Value {
  const value = evalAny(node, ctx);
  if (Array.isArray(value)) return "#VALUE";
  return value;
}
