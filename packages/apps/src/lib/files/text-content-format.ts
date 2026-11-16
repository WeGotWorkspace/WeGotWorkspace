/**
 * How a document's text is stored: Markdown, HTML or plain text. The editor
 * reads and writes these; lib uses the type for collab saves (#2116).
 */
export const TEXT_EDITOR_CONTENT_FORMATS = ["html", "markdown", "text"] as const;
export type TextEditorContentFormat = (typeof TEXT_EDITOR_CONTENT_FORMATS)[number];
