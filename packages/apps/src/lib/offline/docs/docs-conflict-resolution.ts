import * as Y from "yjs";
import { rememberSidecarEtag } from "@/text-editor-core/docs-collab/docs-collab-etag";
import { loadYjsSnapshot } from "@/text-editor-core/docs-collab/docs-collab-server-io";
import { SERVER_ORIGIN } from "@/text-editor-core/docs-collab/docs-collab-utils";

export async function resolveDocsConflictUseServer(
  ydoc: Y.Doc,
  yjsUrl: string,
  authToken: string | undefined,
  room?: string,
): Promise<boolean> {
  const snapshot = await loadYjsSnapshot(yjsUrl, ydoc, authToken, SERVER_ORIGIN);
  // The next save must carry the ETag this load saw, or it is refused again.
  if (room) rememberSidecarEtag(room, snapshot.etag);
  return snapshot.applied;
}

export async function resolveDocsConflictKeepLocal(saveNow: () => Promise<void>): Promise<void> {
  await saveNow();
}
