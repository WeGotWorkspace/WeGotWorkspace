/**
 * Plain text with links, for read-only views of notes (calendar events, tasks, contacts).
 * The stored text is never changed: this only splits it into runs for rendering.
 */
export type LinkifyPart =
  { type: "text"; text: string } | { type: "link"; text: string; href: string };

// http(s) URLs up to whitespace or an angle bracket, and bare mailto: links.
const LINK_PATTERN = /\b(?:https?:\/\/|mailto:)[^\s<>"]+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?'"]+$/;
const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/** Drops sentence punctuation and unbalanced closing brackets that follow a URL. */
function trimUrlEnd(raw: string): string {
  let url = raw;
  for (;;) {
    const stripped = url.replace(TRAILING_PUNCTUATION, "");
    const last = stripped.slice(-1);
    const open = { ")": "(", "]": "[", "}": "{" }[last];
    if (open && stripped.split(last).length > stripped.split(open).length) {
      url = stripped.slice(0, -1);
      continue;
    }
    return stripped;
  }
}

/** The href when `candidate` is an http, https or mailto link; otherwise null. */
export function safeLinkHref(candidate: string): string | null {
  try {
    const url = new URL(candidate);
    if (!SAFE_PROTOCOLS.has(url.protocol)) return null;
    if (url.protocol === "mailto:" ? url.pathname === "" : url.hostname === "") return null;
    return url.href;
  } catch {
    return null;
  }
}

export function linkifyText(text: string): LinkifyPart[] {
  const parts: LinkifyPart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(LINK_PATTERN)) {
    const start = match.index ?? 0;
    const raw = trimUrlEnd(match[0]);
    const href = safeLinkHref(raw);
    if (!href) continue;
    if (start > cursor) parts.push({ type: "text", text: text.slice(cursor, start) });
    parts.push({ type: "link", text: raw, href });
    cursor = start + raw.length;
  }
  if (cursor < text.length) parts.push({ type: "text", text: text.slice(cursor) });
  return parts;
}

export function hasLinks(text: string): boolean {
  return linkifyText(text).some((part) => part.type === "link");
}
