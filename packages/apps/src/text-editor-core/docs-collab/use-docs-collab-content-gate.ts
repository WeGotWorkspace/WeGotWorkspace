import { useEffect } from "react";
import type * as Y from "yjs";
import type { DocsCollabUrls } from "./docs-collab-types";
import { isYDocEmpty } from "./docs-collab-utils";

/**
 * Longest the editor waits for a document's first content before it takes
 * input anyway: a peer that should seed may never answer.
 */
export const DOCS_COLLAB_CONTENT_WAIT_MS = 8_000;

/**
 * Whether an empty room has server content on its way. A room in server
 * backoff does (from a peer, or from the reconnect), and so does one held off
 * the server only until a check answers: every Doc opens that way. A room held
 * because its server copy does not exist yet (a note or Doc whose create is
 * still queued) has none to wait for.
 */
export function expectsServerContent(
  urls: Pick<DocsCollabUrls, "roomNotPersistent" | "roomHeldUntilChecked">,
): boolean {
  return !urls.roomNotPersistent || urls.roomHeldUntilChecked === true;
}

/**
 * While an opened document is still empty and its first content is on its way
 * (the server text, or a peer's copy), typing would land in an empty document
 * that the content then arrives into: the text ends up before it, and keys
 * pressed while it lands can be dropped (#2056). The join holds the editor
 * read-only for that moment. This releases the hold once the document has
 * content from anywhere, once a check answers that none is expected after all
 * (see {@link expectsServerContent}), and after
 * {@link DOCS_COLLAB_CONTENT_WAIT_MS} at most.
 */
export function useDocsCollabContentGate(
  ydoc: Y.Doc | null | undefined,
  awaitingContent: boolean,
  release: () => void,
  urls: Pick<DocsCollabUrls, "roomNotPersistent" | "roomHeldUntilChecked"> = {},
): void {
  const contentExpected = expectsServerContent(urls);
  useEffect(() => {
    if (!awaitingContent || !ydoc) return;
    if (!contentExpected) {
      release();
      return;
    }
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
  }, [awaitingContent, contentExpected, release, ydoc]);
}
