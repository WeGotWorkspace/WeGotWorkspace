const MARKDOWN_HEADING_TITLE = /^#{1,6}\s+(.+)$/;

/**
 * First heading or first non-empty line — used once when SUMMARY is empty.
 * The first line must be complete (another line follows after TipTap trailing
 * blanks) so a live first keystroke cannot leak into the title field.
 */
export function titleFromNoteMarkdown(markdown: string): string | null {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") {
    lines.pop();
  }
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (!trimmed) continue;
    if (i === lines.length - 1) return null;
    const heading = MARKDOWN_HEADING_TITLE.exec(trimmed);
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
