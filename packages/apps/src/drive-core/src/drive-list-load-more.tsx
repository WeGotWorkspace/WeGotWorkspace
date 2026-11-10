import { useRef } from "react";
import { LoaderCircle } from "lucide-react";
import { CollectionListEnd } from "@/collection-layout/src/collection-list-end";
import { useCollectionListEndReached } from "@/collection-layout/src/use-collection-list-end-reached";

export type DriveListLoadMoreProps = {
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  /** Screen reader text while the next page loads. */
  loadingLabel: string;
};

/**
 * End of a long Drive or Docs listing (All Files, All Docs): the next page
 * loads by itself when the end scrolls into view, with a quiet spinner.
 */
export function DriveListLoadMore({
  hasMore,
  loadingMore,
  onLoadMore,
  loadingLabel,
}: DriveListLoadMoreProps) {
  const listEndRef = useRef<HTMLDivElement | null>(null);
  // Off while a page loads; back on after it, so a short page keeps loading.
  useCollectionListEndReached(listEndRef, hasMore && !loadingMore, onLoadMore);
  if (!hasMore) return null;
  return (
    <div className="drive-browser-load-more">
      {loadingMore ? (
        <LoaderCircle className="size-5 animate-spin" role="status" aria-label={loadingLabel} />
      ) : null}
      <CollectionListEnd listEndRef={listEndRef} />
    </div>
  );
}
