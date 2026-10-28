import { avatarColorForUserId } from "@/user-avatar/src/user-avatar-color";
import type { DocsSuggestionAuthor } from "../docs-suggestions-types";

export const UNKNOWN_SUGGESTION_AUTHOR: DocsSuggestionAuthor = { authorId: "", authorName: "" };

/**
 * Author of a suggestion from its thread root. The colour is assigned on the
 * client per principal, so it is the same on every card and every device.
 * No thread (an older document) → unknown author.
 */
export function suggestionAuthorFromThread(
  createdBy: { id: string; name: string } | null | undefined,
): DocsSuggestionAuthor {
  const authorId = createdBy?.id?.trim() ?? "";
  const authorName = createdBy?.name?.trim() ?? "";
  if (!authorId && !authorName) return UNKNOWN_SUGGESTION_AUTHOR;
  return {
    authorId,
    authorName: authorName || authorId,
    authorColor: avatarColorForUserId(authorId || authorName),
  };
}
