import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { isDocsCollabEditablePath } from "@/docs-core/src/docs-collab-text-files";
import { wgwApiBaseUrl, wgwEnsureFreshAccessToken } from "@/lib/api/wgw/http";
import { getConnectivitySnapshot } from "@/lib/offline/core/browser-online";
import {
  docsCollabPathKeyedSources,
  docsCollabRoomKey,
  migrateDocsCollabPendingSaveFromLegacy,
  resolveDocsCollabDatabase,
} from "@/text-editor-core/docs-collab/docs-collab-persistence";
import { applyContentSeedToYDoc } from "@/text-editor-core/docs-collab/docs-collab-editor-surface";
import { isRateLimitedError } from "@/lib/offline/core/background-sync-pacer";
import { loadSnapshotOutcome } from "@/text-editor-core/docs-collab/docs-collab-bootstrap";
import { rememberSidecarEtag } from "@/text-editor-core/docs-collab/docs-collab-etag";
import {
  fetchYjsSnapshot,
  loadMarkdown,
} from "@/text-editor-core/docs-collab/docs-collab-server-io";
import {
  collabDocumentFormat,
  isYDocEmpty,
  SERVER_ORIGIN,
} from "@/text-editor-core/docs-collab/docs-collab-utils";

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
};

/** Seed an empty editable doc into y-indexeddb (offline create before first open). */
export async function seedEmptyDocsCollabOffline(apiPath: string): Promise<void> {
  const room = docsCollabRoomKey(apiPath);
  if (!isDocsCollabEditablePath(room)) return;

  const documentFormat = collabDocumentFormat(room);
  const database = await resolveDocsCollabDatabase(room);
  const ydoc = new Y.Doc();
  const persistence = new IndexeddbPersistence(database.name, ydoc);
  try {
    await persistence.whenSynced;
    if (database.nodeId) {
      await migrateDocsCollabPendingSaveFromLegacy(
        room,
        persistence,
        docsCollabPathKeyedSources(room),
      );
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
 * The snapshot comes first. The markdown is fetched only when the server has no
 * sidecar and the local copy is empty, so a document costs one request when it
 * has a sidecar. A failed load throws: the caller must not mark it synced.
 */
export async function hydrateDocsCollabForOffline({
  apiPath,
  authToken,
  beforeRequest,
  keepLocalCopy = false,
}: DocsPinHydrateInput): Promise<void> {
  const room = docsCollabRoomKey(apiPath);
  if (!isDocsCollabEditablePath(room)) {
    throw new Error("Only editable text files can be made available offline.");
  }

  const urls = buildDocsCollabUrlsForPath(room);
  const documentFormat = collabDocumentFormat(room);
  const database = await resolveDocsCollabDatabase(room);
  const ydoc = new Y.Doc();
  const persistence = new IndexeddbPersistence(database.name, ydoc);

  try {
    await persistence.whenSynced;
    if (database.nodeId) {
      await migrateDocsCollabPendingSaveFromLegacy(
        room,
        persistence,
        docsCollabPathKeyedSources(room),
      );
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
          return fetchYjsSnapshot(urls.yjsUrl, resolvedAuthToken);
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
      if (snapshot.kind === "snapshot") {
        Y.applyUpdate(ydoc, snapshot.update, SERVER_ORIGIN);
        rememberSidecarEtag(room, snapshot.etag);
      } else if (snapshot.kind === "absent") {
        rememberSidecarEtag(room, null);
        if (isYDocEmpty(ydoc)) {
          await beforeRequest?.();
          const markdown = await loadMarkdown(urls.documentUrl, resolvedAuthToken);
          if (markdown) applyContentSeedToYDoc(ydoc, markdown, documentFormat);
        }
      }
    } else if (isYDocEmpty(ydoc)) {
      throw new Error("Go online once to download this document for offline use.");
    }
  } finally {
    await persistence.destroy();
    ydoc.destroy();
  }
}
