/** First heading or first non-empty line — used once when SUMMARY is empty. */
export function titleFromNoteMarkdown(markdown: string): string | null {
  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const heading = /^#{1,6}\s+(.+)$/.exec(trimmed);
    const title = (heading?.[1] ?? trimmed).trim();
    return title || null;
  }
  return null;
}

export function shouldAutofillNoteTitle(current: string | null | undefined): boolean {
  return current == null || current.trim() === "";
}

export function autofillNoteTitle(
  current: string | null | undefined,
  markdown: string,
): string | null {
  if (!shouldAutofillNoteTitle(current)) return current ?? null;
  return titleFromNoteMarkdown(markdown);
}
