import type { Node } from "./ast";
import { tokenize, type Token } from "./tokenize";

const COMPARE = new Set(["=", "<>", "<", ">", "<=", ">="]);
const ADD = new Set(["+", "-"]);
const MUL = new Set(["*", "/", "%"]);

export function parseFormula(src: string): Node {
  const tokens = tokenize(src);
  let index = 0;

  const peek = (): Token | undefined => tokens[index];
  const eat = (): Token => {
    const token = tokens[index];
    if (!token) throw new Error("#SYNTAX");
    index += 1;
    return token;
  };
  const eatOp = (ops: Set<string>): string => {
    const token = eat();
    if (token.t !== "op" || !ops.has(token.v)) throw new Error("#SYNTAX");
    return token.v;
  };

  const parseCompare = (): Node => {
    let left = parseAdd();
    for (;;) {
      const token = peek();
      if (!token || token.t !== "op" || !COMPARE.has(token.v)) break;
      const op = eatOp(COMPARE);
      left = { k: "bin", op, l: left, r: parseAdd() };
    }
    return left;
  };

  const parseAdd = (): Node => {
    let left = parseMul();
    for (;;) {
      const token = peek();
      if (!token || token.t !== "op" || !ADD.has(token.v)) break;
      const op = eatOp(ADD);
      left = { k: "bin", op, l: left, r: parseMul() };
    }
    return left;
  };

  const parseMul = (): Node => {
    let left = parseUnary();
    for (;;) {
      const token = peek();
      if (!token || token.t !== "op" || !MUL.has(token.v)) break;
      const op = eatOp(MUL);
      left = { k: "bin", op, l: left, r: parseUnary() };
    }
    return left;
  };

  // Unary minus binds looser than ^, so -2^2 is -(2^2).
  const parseUnary = (): Node => {
    if (peek()?.t === "op" && peek()?.v === "-") {
      eat();
      return { k: "unary", op: "-", arg: parseUnary() };
    }
    return parsePower();
  };

  const parsePower = (): Node => {
    const left = parsePrimary();
    if (peek()?.t === "op" && peek()?.v === "^") {
      eat();
      return { k: "bin", op: "^", l: left, r: parseUnary() };
    }
    return left;
  };

  const parsePrimary = (): Node => {
    const token = eat();
    if (token.t === "num") return { k: "num", v: token.v };
    if (token.t === "str") return { k: "str", v: token.v };
    if (token.t === "op" && token.v === "(") {
      const inner = parseCompare();
      const close = eat();
      if (close.t !== "op" || close.v !== ")") throw new Error("#SYNTAX");
      return inner;
    }
    if (token.t === "ident") return parseIdent(token.v);
    throw new Error("#SYNTAX");
  };

  /** `sheet!rest` → [sheet, rest]; no sheet → [undefined, ident]. */
  const splitSheet = (ident: string): [string | undefined, string] => {
    const bang = ident.indexOf("!");
    // `#REF!` (a deleted column or sheet) is an error literal, not a sheet prefix.
    return bang < 0 || ident === "#REF!" ? [undefined, ident] : [ident.slice(0, bang), ident.slice(bang + 1)];
  };

  const parseIdent = (fullIdent: string): Node => {
    const next = peek();
    const [sheet, rawIdent] = next?.t === "op" && next.v === "(" ? [undefined, fullIdent] : splitSheet(fullIdent);
    const ident = next?.t === "op" && next.v === "(" ? rawIdent : rawIdent.replaceAll("$", "");
    if (next?.t === "op" && next.v === "(") {
      eat();
      const args: Node[] = [];
      if (!(peek()?.t === "op" && peek()?.v === ")")) {
        args.push(parseCompare());
        while (peek()?.t === "op" && peek()?.v === ",") {
          eat();
          args.push(parseCompare());
        }
      }
      const close = eat();
      if (close.t !== "op" || close.v !== ")") throw new Error("#SYNTAX");
      return { k: "call", fn: ident.toUpperCase(), args };
    }
    if (ident.includes("@")) {
      const at = ident.indexOf("@");
      const col = ident.slice(0, at);
      const row = ident.slice(at + 1);
      if (peek()?.t === "op" && peek()?.v === ":") {
        eat();
        const right = eat();
        if (right.t !== "ident" || !right.v.includes("@")) throw new Error("#REF");
        const [rightSheet, rightBody] = splitSheet(right.v);
        // A range stays on one sheet: `p!a1:p!a9` or `p!a1:a9`.
        if (rightSheet !== undefined && rightSheet !== sheet) throw new Error("#REF");
        const rightV = rightBody.replaceAll("$", "");
        const atRight = rightV.indexOf("@");
        const colRight = rightV.slice(0, atRight);
        const rowRight = rightV.slice(atRight + 1);
        const range: Node = { k: "range", col, from: row, to: rowRight };
        if (col !== colRight) range.col2 = colRight;
        if (sheet !== undefined) range.sheet = sheet;
        return range;
      }
      return sheet === undefined ? { k: "ref", col, row } : { k: "ref", col, row, sheet };
    }
    if (peek()?.t === "op" && peek()?.v === ":") throw new Error("#REF");
    // Spec §11.1/A.8: a cross-sheet ref always names a row (`p!totaal1`); "this row" has no
    // meaning on another sheet, and a sheet-qualified def does not exist.
    if (sheet !== undefined) throw new Error("#SYNTAX");
    return { k: "name", path: ident };
  };

  const node = parseCompare();
  if (index !== tokens.length) throw new Error("#SYNTAX");
  return node;
}
