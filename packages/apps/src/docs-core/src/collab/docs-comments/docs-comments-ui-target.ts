const DOCS_COMMENT_UI_SELECTOR =
  ".docs-comments-floating-layer, .docs-comments-thread-card, [data-comment-id], .docs-comments-thread-card__reaction-picker";

export function isDocsCommentUiTarget(
  target: EventTarget | null,
  clientX?: number,
  clientY?: number,
): boolean {
  if (target instanceof Element && target.closest(DOCS_COMMENT_UI_SELECTOR)) {
    return true;
  }

  if (clientX != null && clientY != null && typeof document.elementFromPoint === "function") {
    const hit = document.elementFromPoint(clientX, clientY);
    if (hit instanceof Element && hit.closest(DOCS_COMMENT_UI_SELECTOR)) {
      return true;
    }
  }

  return false;
}
