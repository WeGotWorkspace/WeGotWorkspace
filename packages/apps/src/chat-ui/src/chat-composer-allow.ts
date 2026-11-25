import type { TextEditorFeature } from "@/text-editor-core/src/text-editor-extensions";

/** Text, bold, italic, links and mentions: the default, and what task and Docs comments use. */
export const CHAT_COMPOSER_BASIC: readonly TextEditorFeature[] = ["bold", "italic", "link"];

/** The basic set plus inline code, lists, quotes and code blocks (Chat and Meet). */
export const CHAT_COMPOSER_RICH: readonly TextEditorFeature[] = [
  ...CHAT_COMPOSER_BASIC,
  "code",
  "bulletList",
  "orderedList",
  "blockquote",
  "codeBlock",
];
