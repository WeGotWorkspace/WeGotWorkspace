import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { isDocsCollabEditablePath } from "@/docs-core/src/docs-collab-text-files";
import { wgwApiBaseUrl, wgwEnsureFreshAccessToken } from "@/lib/api/wgw/http";
import { getConnectivitySnapshot } from "@/lib/offline/core/browser-online";
import {
  docsCollabIndexedDbKey,
  docsCollabRoomKey,
} from "@/text-editor-core/docs-collab/docs-collab-persistence";
import { applyContentSeedToYDoc } from "@/text-editor-core/docs-collab/docs-collab-editor-surface";
import { loadBootstrapInParallel } from "@/text-editor-core/docs-collab/docs-collab-bootstrap";
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
};

/** Seed an empty editable doc into y-indexeddb (offline create before first open). */
export async function seedEmptyDocsCollabOffline(apiPath: string): Promise<void> {
  const room = docsCollabRoomKey(apiPath);
  if (!isDocsCollabEditablePath(room)) return;

  const documentFormat = collabDocumentFormat(room);
  const ydoc = new Y.Doc();
  const persistence = new IndexeddbPersistence(docsCollabIndexedDbKey(room), ydoc);
  try {
    await persistence.whenSynced;
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
 */
export async function hydrateDocsCollabForOffline({
  apiPath,
  authToken,
}: DocsPinHydrateInput): Promise<void> {
  const room = docsCollabRoomKey(apiPath);
  if (!isDocsCollabEditablePath(room)) {
    throw new Error("Only editable text files can be made available offline.");
  }

  const urls = buildDocsCollabUrlsForPath(room);
  const documentFormat = collabDocumentFormat(room);
  const ydoc = new Y.Doc();
  const persistence = new IndexeddbPersistence(docsCollabIndexedDbKey(room), ydoc);

  try {
    await persistence.whenSynced;

    if (getConnectivitySnapshot()) {
      const resolvedAuthToken =
        authToken !== undefined ? authToken : ((await wgwEnsureFreshAccessToken()) ?? undefined);
      const load = await loadBootstrapInParallel({
        loadMarkdown: () => loadMarkdown(urls.documentUrl, resolvedAuthToken),
        fetchSnapshot: () => fetchYjsSnapshot(urls.yjsUrl, resolvedAuthToken),
      });

      if (load.snapshot.kind === "snapshot") {
        Y.applyUpdate(ydoc, load.snapshot.update, SERVER_ORIGIN);
        rememberSidecarEtag(room, load.snapshot.etag);
      } else if (load.snapshot.kind === "absent") {
        rememberSidecarEtag(room, null);
      }

      // C7: seed only when the server confirmed there is no sidecar. A failed
      // snapshot load leaves the local state alone rather than duplicating it.
      const maySeed = load.snapshot.kind === "absent" || load.snapshot.kind === "skipped";
      if (maySeed && isYDocEmpty(ydoc) && load.markdown) {
        applyContentSeedToYDoc(ydoc, load.markdown, documentFormat);
      }
    } else if (isYDocEmpty(ydoc)) {
      throw new Error("Go online once to download this document for offline use.");
    }
  } finally {
    await persistence.destroy();
    ydoc.destroy();
  }
}
