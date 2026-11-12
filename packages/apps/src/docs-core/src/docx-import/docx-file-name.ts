/** `Report.docx` → `Report.md`. Kept apart so callers do not load the converter. */
export function markdownNameFor(sourceName: string): string {
  const dot = sourceName.lastIndexOf(".");
  const base = (dot > 0 ? sourceName.slice(0, dot) : sourceName).trim() || "Untitled";
  return `${base}.md`;
}
