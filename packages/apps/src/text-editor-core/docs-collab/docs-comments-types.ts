import { REACTION_EMOJIS } from "@/reaction-picker/src/reaction-emojis";
export type DocsCommentAuthor = {
  id: string;
  name: string;
};

export type DocsCommentMessage = {
  id: string;
  body: string;
  createdAt: string;
  author: DocsCommentAuthor;
};

/** Thread-level emoji reactions keyed by emoji with reacting user ids. */
export type DocsCommentReaction = {
  emoji: string;
  userIds: string[];
};

export type DocsCommentThread = {
  id: string;
  anchorText: string;
  /** ProseMirror positions captured when the comment was created. */
  anchorFrom?: number;
  anchorTo?: number;
  /** Which duplicate `anchorText` match this thread refers to (0-based). */
  anchorOccurrence?: number;
  createdAt: string;
  createdBy: DocsCommentAuthor;
  resolved: boolean;
  messages: DocsCommentMessage[];
  reactions?: DocsCommentReaction[];
};

/** Emojis available in the thread reaction picker. */
/** The suite reaction set (`ReactionPicker`), shared with chat. */
export const DOCS_COMMENT_REACTION_EMOJIS = REACTION_EMOJIS;

export const DOCS_COMMENTS_MAP_KEY = "comments";
