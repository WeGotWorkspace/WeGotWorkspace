export type Token =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "ident"; v: string }
  | { t: "op"; v: string };

export type Span =
  | { t: "ws"; raw: string }
  | { t: "num"; v: number; raw: string }
  | { t: "str"; v: string; raw: string }
  | { t: "ident"; v: string; raw: string }
  | { t: "op"; v: string; raw: string };

const IDENT =
  /[A-Za-z_\u00C0-\u024F][A-Za-z0-9_\u00C0-\u024F]*(@[A-Za-z0-9_-]+)?(\.[A-Za-z0-9_\u00C0-\u024F]+)?/y;

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= "0" && char <= "9";
}

function readNumber(src: string, start: number): { v: number; raw: string; next: number } | null {
  let i = start;
  if (src[i] === ".") {
    if (!isDigit(src[i + 1])) return null;
    i += 1;
    while (isDigit(src[i])) i += 1;
  } else if (isDigit(src[i])) {
    while (isDigit(src[i])) i += 1;
    if (src[i] === "." && isDigit(src[i + 1])) {
      i += 1;
      while (isDigit(src[i])) i += 1;
    }
  } else {
    return null;
  }
  const raw = src.slice(start, i);
  return { v: Number(raw), raw, next: i };
}

function readString(src: string, start: number): { v: string; raw: string; next: number } {
  let i = start + 1;
  let value = "";
  while (i < src.length) {
    if (src[i] === '"') {
      if (src[i + 1] === '"') {
        value += '"';
        i += 2;
        continue;
      }
      return { v: value, raw: src.slice(start, i + 1), next: i + 1 };
    }
    value += src[i];
    i += 1;
  }
  throw new Error("#SYNTAX");
}

export function scan(src: string): Span[] {
  const spans: Span[] = [];
  let i = 0;
  while (i < src.length) {
    const char = src[i] ?? "";
    if (/\s/.test(char)) {
      let j = i + 1;
      while (j < src.length && /\s/.test(src[j] ?? "")) j += 1;
      spans.push({ t: "ws", raw: src.slice(i, j) });
      i = j;
      continue;
    }
    if (char === '"') {
      const str = readString(src, i);
      spans.push({ t: "str", v: str.v, raw: str.raw });
      i = str.next;
      continue;
    }
    if (src.startsWith("#REF!", i)) {
      spans.push({ t: "ident", v: "#REF!", raw: "#REF!" });
      i += "#REF!".length;
      continue;
    }
    const num = readNumber(src, i);
    if (num) {
      spans.push({ t: "num", v: num.v, raw: num.raw });
      i = num.next;
      continue;
    }
    IDENT.lastIndex = i;
    const ident = IDENT.exec(src);
    if (ident && ident.index === i) {
      spans.push({ t: "ident", v: ident[0], raw: ident[0] });
      i += ident[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "<>") {
      spans.push({ t: "op", v: two, raw: two });
      i += 2;
      continue;
    }
    if ("+-*/^%=<>:,()".includes(char)) {
      spans.push({ t: "op", v: char, raw: char });
      i += 1;
      continue;
    }
    throw new Error("#SYNTAX");
  }
  return spans;
}

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  for (const span of scan(src)) {
    if (span.t === "ws") continue;
    if (span.t === "num") tokens.push({ t: "num", v: span.v });
    else if (span.t === "str") tokens.push({ t: "str", v: span.v });
    else if (span.t === "ident") tokens.push({ t: "ident", v: span.v });
    else tokens.push({ t: "op", v: span.v });
  }
  return tokens;
}
