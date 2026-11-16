import type { Editor } from "@tiptap/react";
import {
  plainTextFromEditor,
  plainTextToTiptapContent,
} from "@/text-editor-core/src/text-editor-plain-content";

import type { TextEditorContentFormat } from "@/lib/files/text-content-format";

export {
  TEXT_EDITOR_CONTENT_FORMATS,
  type TextEditorContentFormat,
} from "@/lib/files/text-content-format";

type TextEditorMarkdownStorage = {
  markdown?: {
    getMarkdown: () => string;
  };
};

/** Read editor document in the configured serialization format. */
export function getTextEditorContent(editor: Editor, format: TextEditorContentFormat): string {
  if (format === "text") {
    return plainTextFromEditor(editor);
  }
  if (format === "markdown") {
    const markdown = (editor.storage as TextEditorMarkdownStorage).markdown?.getMarkdown();
    if (markdown != null) return markdown;
  }
  return editor.getHTML();
}

/** Replace the full document from HTML, Markdown, or plain text. */
export function setTextEditorContent(
  editor: Editor,
  content: string,
  format: TextEditorContentFormat = "html",
): void {
  if (format === "text") {
    editor.commands.setContent(plainTextToTiptapContent(content), { emitUpdate: false });
    return;
  }
  editor.commands.setContent(content, { emitUpdate: false });
}

/** Initial `useEditor` content for the configured format. */
export function initialTextEditorContent(content: string, format: TextEditorContentFormat) {
  if (format === "text") {
    return plainTextToTiptapContent(content);
  }
  return content;
}
