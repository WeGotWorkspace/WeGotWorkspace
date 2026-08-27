import type { RefObject } from "react";
import "./collection-layout.css";

type CollectionListEndProps = {
  listEndRef: RefObject<HTMLDivElement | null>;
};

/** Invisible end-of-list sentinel for {@link useCollectionListEndReached}. */
export function CollectionListEnd({ listEndRef }: CollectionListEndProps) {
  return <div ref={listEndRef} className="collection-list-end" aria-hidden />;
}
