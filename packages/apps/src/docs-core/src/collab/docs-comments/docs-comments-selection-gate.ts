export type CommentComposeGateInput = {
  isSelecting: boolean;
  anchorText: string | null;
};

/** True only when the user finished selecting text and can start a comment draft. */
export function shouldOfferCommentCompose(input: CommentComposeGateInput): boolean {
  if (input.isSelecting) return false;
  return input.anchorText != null;
}
