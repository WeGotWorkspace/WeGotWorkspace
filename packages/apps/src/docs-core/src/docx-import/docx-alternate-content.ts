/**
 * Word and LibreOffice store shapes such as text boxes twice, inside
 * `<mc:AlternateContent>`: a modern `<mc:Choice>` and an older `<mc:Fallback>`.
 * mammoth reads only the fallback. These helpers let the scan count each shape
 * once and tell whether its text reaches the Doc.
 */

function isTagBoundary(char: string | undefined): boolean {
  return (
    char === ">" || char === "/" || char === " " || char === "\n" || char === "\r" || char === "\t"
  );
}

/** Index after the end of the element opened at `start`, nested ones included. */
function elementEnd(xml: string, start: number, tag: string): number {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  const tagEnd = xml.indexOf(">", start);
  if (tagEnd < 0) return xml.length;
  if (xml[tagEnd - 1] === "/") return tagEnd + 1;
  let depth = 1;
  let cursor = tagEnd + 1;
  while (depth > 0) {
    const nextClose = xml.indexOf(close, cursor);
    if (nextClose < 0) return xml.length;
    const nextOpen = xml.indexOf(open, cursor);
    if (nextOpen >= 0 && nextOpen < nextClose && isTagBoundary(xml[nextOpen + open.length])) {
      const nestedEnd = xml.indexOf(">", nextOpen);
      if (nestedEnd < 0) return xml.length;
      if (xml[nestedEnd - 1] !== "/") depth += 1;
      cursor = nestedEnd + 1;
    } else {
      depth -= 1;
      cursor = nextClose + close.length;
    }
  }
  return cursor;
}

/** Splits `xml` into the parts inside and outside every `<tag>` element. A linear walk. */
export function splitElements(xml: string, tag: string): { inside: string; outside: string } {
  const open = `<${tag}`;
  let inside = "";
  let outside = "";
  let pos = 0;
  for (;;) {
    const start = xml.indexOf(open, pos);
    if (start < 0) break;
    if (!isTagBoundary(xml[start + open.length])) {
      outside += xml.slice(pos, start + open.length);
      pos = start + open.length;
      continue;
    }
    const end = elementEnd(xml, start, tag);
    outside += xml.slice(pos, start);
    inside += xml.slice(start, end);
    pos = end;
  }
  return { inside, outside: outside + xml.slice(pos) };
}
