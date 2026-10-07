import * as Y from "yjs";
import { isYDocEmpty } from "./docs-collab-utils";

/**
 * The collab mesh may run only after HTTP / sidecar bootstrap (or an intentional
 * offline seed) has populated the Y.Doc. An empty doc must not answer sync
 * step 1 — its step 2 reply can wipe peers that already hold the body.
 */
export function isMeshDocumentHydrated(ydoc: Y.Doc, seedDone: boolean): boolean {
  return seedDone || !isYDocEmpty(ydoc);
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
