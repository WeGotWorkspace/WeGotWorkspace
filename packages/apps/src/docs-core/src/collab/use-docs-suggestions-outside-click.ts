import { useEffect } from "react";

/** A suggestion card, its mark in the text, the floating layer, or the reaction picker. */
const SUGGESTION_UI_SELECTOR =
  "[data-change-id], .docs-suggestions-floating-layer, .reaction-picker";

function isSuggestionUiTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(SUGGESTION_UI_SELECTOR));
}

/** Like comments: a click outside the selected suggestion folds its card back up. */
export function useDocsSuggestionsOutsideClick(
  activeChangeId: string | null,
  clearActiveSuggestion: () => void,
): void {
  useEffect(() => {
    if (activeChangeId == null) return;
    let pendingOutsideClear = false;

    const handlePointerDown = (event: PointerEvent) => {
      pendingOutsideClear = !isSuggestionUiTarget(event.target);
    };
    const handleClick = (event: MouseEvent) => {
      if (isSuggestionUiTarget(event.target) || !pendingOutsideClear) {
        pendingOutsideClear = false;
        return;
      }
      pendingOutsideClear = false;
      clearActiveSuggestion();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("click", handleClick, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("click", handleClick, true);
    };
  }, [activeChangeId, clearActiveSuggestion]);
}
