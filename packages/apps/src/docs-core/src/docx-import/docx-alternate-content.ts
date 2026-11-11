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

/**
 * Index after the end of the element opened at `start`, nested ones included.
 * Linear: the next open and close tags are found once and only searched again
 * when the cursor has passed them, so many nested or self-closing children
 * cannot make each step rescan to a far-away close tag.
 */
function elementEnd(xml: string, start: number, tag: string): number {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  const tagEnd = xml.indexOf(">", start);
  if (tagEnd < 0) return xml.length;
  if (xml[tagEnd - 1] === "/") return tagEnd + 1;
  let depth = 1;
  let cursor = tagEnd + 1;
  let nextClose = -1;
  let nextOpen = -1;
  while (depth > 0) {
    if (nextClose < cursor) {
      nextClose = xml.indexOf(close, cursor);
      if (nextClose < 0) return xml.length;
    }
    if (nextOpen < cursor) {
      nextOpen = xml.indexOf(open, cursor);
      // None left: park it past the end so it is never searched again.
      if (nextOpen < 0) nextOpen = xml.length;
    }
    if (nextOpen < nextClose) {
      if (isTagBoundary(xml[nextOpen + open.length])) {
        const nestedEnd = xml.indexOf(">", nextOpen);
        if (nestedEnd < 0) return xml.length;
        if (xml[nestedEnd - 1] !== "/") depth += 1;
        cursor = nestedEnd + 1;
      } else {
        // `<tagX`: another element whose name only starts the same.
        cursor = nextOpen + open.length;
      }
      continue;
    }
    depth -= 1;
    cursor = nextClose + close.length;
  }
  return cursor;
}

/**
 * The start tags `<name …>` in `xml`, attributes included, in order. A linear
 * walk: it stops at the first tag without a closing `>` instead of scanning to
 * the end of the string again for every later one, as a `[^>]*` regex would.
 */
export function startTags(xml: string, name: string): { tag: string; end: number }[] {
  const open = `<${name}`;
  const tags: { tag: string; end: number }[] = [];
  let from = 0;
  for (;;) {
    const start = xml.indexOf(open, from);
    if (start < 0) return tags;
    const next = xml[start + open.length];
    if (next !== ">" && next !== "/" && !isTagBoundary(next)) {
      from = start + open.length;
      continue;
    }
    const end = xml.indexOf(">", start);
    if (end < 0) return tags;
    tags.push({ tag: xml.slice(start, end + 1), end: end + 1 });
    from = end + 1;
  }
}

/** Splits `xml` into the parts inside and outside every `<tag>` element. Linear in the input. */
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
