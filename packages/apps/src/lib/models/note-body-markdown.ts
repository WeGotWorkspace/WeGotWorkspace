import removeMd from "remove-markdown";

/**
 * Builds one markdown document for the note editor from `Note.body`.
 * Legacy rows use one string per paragraph; after saving from the editor we persist `[markdown]`.
 */
export function noteBodyToMarkdown(body: string[]): string {
  if (body.length === 0) return "";
  return body.join("\n\n");
}

/**
 * Inverse of {@link noteBodyToMarkdown}: split a collab markdown document into
 * `Note.body` paragraphs (blank-line separated).
 */
export function markdownToNoteBody(markdown: string): string[] {
  const trimmed = markdown.trim();
  if (!trimmed) return [""];
  const parts = trimmed
    .split(/\n\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [trimmed];
}

/**
 * Strips GFM task-list markers (`- [ ]` / `- [x]` / bare `[ ]`).
 * `remove-markdown` drops the list bullet but leaves checkbox brackets behind.
 */
function stripTaskListMarkers(markdown: string): string {
  return markdown.replace(/^\s*[-*+]\s+\[[ xX]\]\s*/gm, "").replace(/\[[ xX]\]\s*/g, "");
}

/** Strips markdown / inline HTML for list previews, search, and excerpts. */
export function markdownToPlainText(markdown: string): string {
  return removeMd(stripTaskListMarkers(markdown)).replace(/\s+/g, " ").trim();
}
