/**
 * Docs-only card pieces (replies, reactions, highlights, floating layout), plus the
 * shared card shell, header and sidebar panel from the engine (#2116).
 */
export * from "@/text-editor-core/docs-collab/docs-collab-card";
export { useDocsCollabFloatingLayerLayout } from "./use-docs-collab-floating-layer-layout";
export type {
  DocsCollabFloatingLayerLayout,
  UseDocsCollabFloatingLayerLayoutOptions,
  UseDocsCollabFloatingLayerLayoutResult,
} from "./use-docs-collab-floating-layer-layout";
export { DocsCollabMessageReply, DocsCommentsReply } from "./docs-collab-message-reply";
export type {
  DocsCollabMessageReplyProps,
  DocsCommentsReplyProps,
} from "./docs-collab-message-reply";
export { DocsCollabReactions, reactionAuthorNames } from "./docs-collab-reactions";
export type { DocsCollabReactionsProps } from "./docs-collab-reactions";
export { DocsCollabHighlightText } from "./docs-collab-highlight-text";
export type {
  DocsCollabHighlightTextProps,
  DocsCollabHighlightVariant,
} from "./docs-collab-highlight-text";
