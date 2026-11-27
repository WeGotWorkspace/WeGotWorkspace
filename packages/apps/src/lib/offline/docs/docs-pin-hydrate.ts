import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { loadCollabContentCodec } from "@/lib/collab/collab-content-codec";
import { isDocsCollabEditablePath } from "@/lib/files/docs-collab-text-files";
import { wgwApiBaseUrl, wgwEnsureFreshAccessToken } from "@/lib/api/wgw/http";
import { getConnectivitySnapshot } from "@/lib/offline/core/browser-online";
import {
  docsCollabRoomKey,
  migrateDocsCollabPathDatabaseToIdentity,
  resolveDocsCollabDatabase,
} from "@/lib/collab/docs-collab-persistence";
import { isRateLimitedError } from "@/lib/offline/core/background-sync-pacer";
import { loadSnapshotOutcome } from "@/lib/collab/docs-collab-bootstrap";
import { rememberSidecarEtag } from "@/lib/collab/docs-collab-etag";
import { fetchYjsSnapshot, loadMarkdown } from "@/lib/collab/docs-collab-server-io";
import { collabDocumentFormat, isYDocEmpty, SERVER_ORIGIN } from "@/lib/collab/docs-collab-utils";

export function buildDocsCollabUrlsForPath(apiPath: string): {
  room: string;
  documentUrl: string;
  yjsUrl: string;
} {
  const room = docsCollabRoomKey(apiPath);
  const baseUrl = wgwApiBaseUrl();
  const pathQuery = encodeURIComponent(room);
  return {
    room,
    documentUrl: `${baseUrl}/files/collaboration?path=${pathQuery}`,
    yjsUrl: `${baseUrl}/files/collaboration?path=${pathQuery}&format=yjs`,
  };
}

export type DocsPinHydrateInput = {
  apiPath: string;
  authToken?: string;
  /** Background sync paces every request through this. */
  beforeRequest?: () => Promise<void>;
  /** Skip the network when the local copy is not empty (it is known to be current). */
  keepLocalCopy?: boolean;
  /** False once a newer run replaced this one: the late answer is not applied. */
  shouldWrite?: () => boolean;
};

/** Seed an empty editable doc into y-indexeddb (offline create before first open). */
export async function seedEmptyDocsCollabOffline(apiPath: string): Promise<void> {
  const room = docsCollabRoomKey(apiPath);
  if (!isDocsCollabEditablePath(room)) return;

  const documentFormat = collabDocumentFormat(room);
  const { applyContentSeedToYDoc } = await loadCollabContentCodec();
  const database = await resolveDocsCollabDatabase(room);
  const ydoc = new Y.Doc();
  const persistence = new IndexeddbPersistence(database.name, ydoc);
  try {
    await persistence.whenSynced;
    // An editor still has the path-keyed copy open (#1933): it owns the body.
    if (database.nodeId && !(await migrateDocsCollabPathDatabaseToIdentity(room, persistence))) {
      return;
    }
    if (isYDocEmpty(ydoc)) {
      applyContentSeedToYDoc(ydoc, "", documentFormat);
    }
  } finally {
    await persistence.destroy();
    ydoc.destroy();
  }
}

/**
 * Headless collab bootstrap: hydrate y-indexeddb for a room without joining mesh.
 * Mirrors join server bootstrap when online; leaves local IDB state when offline.
 *
 * One request per document: `&fallback=markdown` returns the sidecar, or the
 * markdown when there is none. A server without the fallback answers 204, and
 * the markdown is then fetched separately. A failed load throws: the caller
 * must not mark it synced.
 */
export async function hydrateDocsCollabForOffline({
  apiPath,
  authToken,
  beforeRequest,
  keepLocalCopy = false,
  shouldWrite,
}: DocsPinHydrateInput): Promise<void> {
  const room = docsCollabRoomKey(apiPath);
  if (!isDocsCollabEditablePath(room)) {
    throw new Error("Only editable text files can be made available offline.");
  }

  const urls = buildDocsCollabUrlsForPath(room);
  const documentFormat = collabDocumentFormat(room);
  const { applyContentSeedToYDoc } = await loadCollabContentCodec();
  const database = await resolveDocsCollabDatabase(room);
  const ydoc = new Y.Doc();
  const persistence = new IndexeddbPersistence(database.name, ydoc);

  try {
    await persistence.whenSynced;
    // An editor still has the path-keyed copy open (#1933). It owns the body
    // and saves it; filling the id-keyed copy now would leave its text behind
    // when it later opens by id.
    if (database.nodeId && !(await migrateDocsCollabPathDatabaseToIdentity(room, persistence))) {
      return;
    }

    if (keepLocalCopy && !isYDocEmpty(ydoc)) return;

    if (getConnectivitySnapshot()) {
      const resolvedAuthToken =
        authToken !== undefined ? authToken : ((await wgwEnsureFreshAccessToken()) ?? undefined);
      // A 429 stops the retries at once; the caller's pacer decides when to try again.
      let rateLimited = false;
      const snapshot = await loadSnapshotOutcome(
        async () => {
          await beforeRequest?.();
          return fetchYjsSnapshot(`${urls.yjsUrl}&fallback=markdown`, resolvedAuthToken);
        },
        {
          isCurrent: () => !rateLimited,
          onAttemptFailed: (error) => {
            if (isRateLimitedError(error)) rateLimited = true;
          },
        },
      );

      // C7: seed only when the server confirmed there is no sidecar. A failed
      // snapshot load leaves the local state alone rather than duplicating it.
      if (snapshot.kind === "failed") throw snapshot.error;
      if (shouldWrite && !shouldWrite()) return;
      if (snapshot.kind === "snapshot") {
        Y.applyUpdate(ydoc, snapshot.update, SERVER_ORIGIN);
        rememberSidecarEtag(room, snapshot.etag);
      } else if (snapshot.kind === "absent") {
        let markdown = snapshot.markdown;
        if (markdown === undefined && isYDocEmpty(ydoc)) {
          await beforeRequest?.();
          markdown = await loadMarkdown(urls.documentUrl, resolvedAuthToken);
          if (shouldWrite && !shouldWrite()) return;
        }
        rememberSidecarEtag(room, null);
        if (markdown && isYDocEmpty(ydoc)) applyContentSeedToYDoc(ydoc, markdown, documentFormat);
      }
    } else if (isYDocEmpty(ydoc)) {
      throw new Error("Go online once to download this document for offline use.");
    }
  } finally {
    await persistence.destroy();
    ydoc.destroy();
  }
}
