import { DOC_STATUS_DOCUMENT_GONE } from "./docs-collab-status";
import type { DocsCollabSessionRefs, DocsCollabUrls } from "./docs-collab-types";

/**
 * The document was deleted, or this account can no longer read it (both
 * answer the same). Stop saving for good and show the "no longer available"
 * state once, however many signals report it.
 */
export function settleDocumentGone(
  refs: DocsCollabSessionRefs,
  urls: DocsCollabUrls,
  setDocStatus: (status: string) => void,
): void {
  if (refs.saveTerminalKindRef.current === "gone") return;
  refs.saveTerminalKindRef.current = "gone";
  refs.saveRetryMsRef.current = Number.POSITIVE_INFINITY;
  refs.nextSaveAttemptAtRef.current = Number.POSITIVE_INFINITY;
  urls.onDocumentGone?.();
  setDocStatus(DOC_STATUS_DOCUMENT_GONE);
}

/**
 * Contract C2 revocation: the server refused the room poll, so this account
 * has lost read access (the caller leaves the live session). Docs answer that
 * like a deleted Doc: one "no longer available" state, no second "Access lost"
 * message. A host without that state keeps the access-lost signal.
 */
export function settleRefusedRoomPoll(
  refs: DocsCollabSessionRefs,
  urls: DocsCollabUrls,
  setDocStatus: (status: string) => void,
): void {
  if (urls.onDocumentGone) settleDocumentGone(refs, urls, setDocStatus);
  else urls.onPersistForbidden?.();
}
