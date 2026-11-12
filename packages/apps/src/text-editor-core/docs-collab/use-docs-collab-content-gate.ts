import { useEffect } from "react";
import type * as Y from "yjs";
import { isYDocEmpty } from "./docs-collab-utils";

/**
 * Longest the editor waits for a document's first content before it takes
 * input anyway: a peer that should seed may never answer.
 */
export const DOCS_COLLAB_CONTENT_WAIT_MS = 8_000;

/**
 * While an opened document is still empty and its first content is on its way
 * (the server text, or a peer's copy), typing would land in an empty document
 * that the content then arrives into: the text ends up before it, and keys
 * pressed while it lands can be dropped (#2056). The join holds the editor
 * read-only for that moment. This releases the hold once the document has
 * content from anywhere, and after {@link DOCS_COLLAB_CONTENT_WAIT_MS} at most.
 */
export function useDocsCollabContentGate(
  ydoc: Y.Doc | null | undefined,
  awaitingContent: boolean,
  release: () => void,
): void {
  useEffect(() => {
    if (!awaitingContent || !ydoc) return;
    const releaseOnContent = () => {
      if (!isYDocEmpty(ydoc)) release();
    };
    releaseOnContent();
    ydoc.on("update", releaseOnContent);
    const timer = setTimeout(release, DOCS_COLLAB_CONTENT_WAIT_MS);
    return () => {
      ydoc.off("update", releaseOnContent);
      clearTimeout(timer);
    };
  }, [awaitingContent, release, ydoc]);
}
