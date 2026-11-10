import type { DocsTrackChangeGroup } from "@/text-editor-core/src/text-editor-track-changes";
import type { UserAvatarColor } from "@/user-avatar/src/user-avatar-color";
import type { DocsCommentMessage, DocsCommentReaction } from "./docs-comments-types";

export type DocsSuggestionThread = {
  changeId: string;
  messages: DocsCommentMessage[];
  reactions?: DocsCommentReaction[];
};

/** Who made a suggestion, from its thread. Empty when there is no thread yet (older documents). */
export type DocsSuggestionAuthor = {
  /** Principal id; `""` when unknown. */
  authorId: string;
  /** Display name; `""` when unknown (cards show "Unknown author"). */
  authorName: string;
  /** Client-side colour per principal; absent when unknown. */
  authorColor?: UserAvatarColor;
};

/** Editor track-change group merged with its suggestion thread. */
export type DocsSuggestionWithThread = DocsTrackChangeGroup &
  DocsSuggestionAuthor & {
    messages: DocsCommentMessage[];
    reactions?: DocsCommentReaction[];
    /** True when the suggestion journal is archived (accept/reject / orphan prune). */
    archived?: boolean;
    /**
     * False while the suggestion has no thread root yet. Only the suggesting
     * session creates the root, so it (and the card's author) is that person:
     * replies and reactions wait for it. Absent means it has one.
     */
    hasThread?: boolean;
  };

export const DOCS_SUGGESTION_THREADS_MAP_KEY = "suggestionThreads";
