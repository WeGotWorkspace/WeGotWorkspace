import { useEffect, type RefObject } from "react";

/** Same prefetch window Mail used for mailbox infinite scroll. */
export const COLLECTION_LIST_END_ROOT_MARGIN = "180px 0px";
export const COLLECTION_LIST_END_THRESHOLD = 0.01;

/**
 * Observe a list-end sentinel and call `onEndReached` when it enters view.
 * Lifted from Mail mailbox paging so Calendar search (and others) share one IO.
 */
export function useCollectionListEndReached(
  listEndRef: RefObject<Element | null>,
  enabled: boolean,
  onEndReached: () => void,
): void {
  useEffect(() => {
    if (!enabled || !listEndRef.current) return;
    if (typeof IntersectionObserver === "undefined") return;
    const el = listEndRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        onEndReached();
      },
      {
        root: null,
        rootMargin: COLLECTION_LIST_END_ROOT_MARGIN,
        threshold: COLLECTION_LIST_END_THRESHOLD,
      },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled, listEndRef, onEndReached]);
}
