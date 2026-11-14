/**
 * Docs' collaboration UI: the workspace, comments, suggestions and review panel
 * built on the shared engine in `text-editor-core/docs-collab` (#2116).
 */
export { DocsCollabWorkspace } from "./docs-collab-workspace";
export type { DocsCollabWorkspaceProps } from "./docs-collab-workspace";
export { DocsCollabSuggestControls } from "./docs-collab-suggest-controls";
export type { DocsCollabSuggestControlsProps } from "./docs-collab-suggest-controls";
export { DocsCollabReviewPanel } from "./docs-collab-review";
export type { DocsCollabReviewPanelProps } from "./docs-collab-review";
export {
  DocsSuggestionCard,
  DocsSuggestionsFloatingLayer,
  DocsSuggestionsPanel,
} from "./docs-suggestions";
export type {
  DocsSuggestionCardProps,
  DocsSuggestionsFloatingLayerProps,
  DocsSuggestionsPanelProps,
} from "./docs-suggestions";
export { useDocsSuggestions } from "./use-docs-suggestions";
export type { UseDocsSuggestionsOptions, UseDocsSuggestionsResult } from "./use-docs-suggestions";
export { getDocsSuggestionThreadsMap } from "./docs-suggestions-map";
export { DocsCommentsPanel, DocsCommentsSidebar } from "./docs-comments";
export type { DocsCommentsPanelProps, DocsCommentsSidebarProps } from "./docs-comments";
export { DocsCommentsFloatingLayer } from "./docs-comments";
export type { DocsCommentsFloatingLayerProps } from "./docs-comments";
export { useDocsComments, getDocsCommentsMap } from "./use-docs-comments";
export type { UseDocsCommentsOptions, UseDocsCommentsResult } from "./use-docs-comments";
export { useDocsCollabPendingSync } from "./use-docs-collab-pending-sync";
export { useDocsCollabFailedSync } from "./use-docs-collab-failed-sync";
