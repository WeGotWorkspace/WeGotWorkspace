/**
 * The features Chat composers use. A subset of the editor's own feature names, spelled out here so this
 * file adds no import edge to text-editor-core; passing it to `allow` is checked against the editor type.
 */
type ChatComposerFeature =
  "bold" | "italic" | "link" | "code" | "bulletList" | "orderedList" | "blockquote" | "codeBlock";

/** Text, bold, italic, links and mentions: the default, and what task and Docs comments use. */
export const CHAT_COMPOSER_BASIC: readonly ChatComposerFeature[] = ["bold", "italic", "link"];

/** The basic set plus inline code, lists, quotes and code blocks (Chat and Meet). */
export const CHAT_COMPOSER_RICH: readonly ChatComposerFeature[] = [
  ...CHAT_COMPOSER_BASIC,
  "code",
  "bulletList",
  "orderedList",
  "blockquote",
  "codeBlock",
];
