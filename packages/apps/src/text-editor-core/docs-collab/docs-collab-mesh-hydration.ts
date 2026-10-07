import * as Y from "yjs";
import { isYDocEmpty } from "./docs-collab-utils";

/**
 * HTTP bootstrap finished or the Y.Doc already has a body. Used to gate
 * outbound document-bearing mesh/HTTP traffic, not inbound pulls.
 */
export function isMeshDocumentHydrated(ydoc: Y.Doc, seedDone: boolean): boolean {
  return seedDone || !isYDocEmpty(ydoc);
}

/** Outbound sync step 2 / update broadcasts — never while empty and unseeded. */
export function mayPublishDocumentBearingMeshSync(ydoc: Y.Doc, seedDone: boolean): boolean {
  return isMeshDocumentHydrated(ydoc, seedDone);
}

/**
 * Answering a peer's sync step 1 with local step 2 while still empty can push
 * a delete diff. Pulls (sending step 1) stay allowed separately.
 */
export function mayAnswerSyncStep1WithLocalState(ydoc: Y.Doc, seedDone: boolean): boolean {
  return isMeshDocumentHydrated(ydoc, seedDone);
}

/** True when applying `update` would clear a non-empty document body. */
export function isDestructiveBodyWipe(doc: Y.Doc, update: Uint8Array): boolean {
  if (isYDocEmpty(doc)) return false;
  const scratch = new Y.Doc();
  try {
    Y.applyUpdate(scratch, Y.encodeStateAsUpdate(doc));
    Y.applyUpdate(scratch, update);
  } catch {
    return false;
  }
  return isYDocEmpty(scratch);
}
