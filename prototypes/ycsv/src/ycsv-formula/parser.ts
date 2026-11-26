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

  const parseIdent = (ident: string): Node => {
    const next = peek();
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
        const atRight = right.v.indexOf("@");
        const colRight = right.v.slice(0, atRight);
        const rowRight = right.v.slice(atRight + 1);
        if (col !== colRight) throw new Error("#REF");
        return { k: "range", col, from: row, to: rowRight };
      }
      return { k: "ref", col, row };
    }
    if (peek()?.t === "op" && peek()?.v === ":") throw new Error("#REF");
    return { k: "name", path: ident };
  };

  const node = parseCompare();
  if (index !== tokens.length) throw new Error("#SYNTAX");
  return node;
}
