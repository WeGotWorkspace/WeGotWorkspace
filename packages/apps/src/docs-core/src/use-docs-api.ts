import { useCallback, useEffect, useMemo } from "react";
import { useOnReconnect } from "@/hooks/use-connectivity";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import { useHybridBootstrap } from "@/lib/live/use-hybrid-bootstrap";
import { readBrowserOnline } from "@/lib/offline/core/browser-online";
import { subscribeOfflineDeviceContentSettings } from "@/lib/offline/core/offline-device-settings";
import { requestDocsBodySyncFromTree } from "@/lib/offline/docs/docs-body-sync";
import { getDocsSyncRunner } from "@/lib/offline/docs/docs-sync-runner";
import {
  notifyDriveRemoteChange,
  subscribeDriveRemoteChanges,
} from "@/lib/offline/drive/drive-file-node-push";
import { getDriveSyncRunner } from "@/lib/offline/drive/drive-hybrid-operations";
import { syncDriveInboundFromFileNodes } from "@/lib/offline/drive/drive-inbound-sync";
import { wgwIsGuestSession } from "@/lib/api/wgw/http";
import { resolveDocsOfflineUsername } from "@/lib/offline/core/offline-session";
import type { DocsAppBootstrap, DocsUIData } from "@/lib/models/docs-types";
import { createDefaultDocsApiSource, type DocsApiSource } from "@/docs-core/src/docs-api-source";
import { uploadPendingDocBodies } from "@/docs-core/src/docs-pending-bodies";

const DOCS_BOOTSTRAP_CACHE_KEY = "wgw.docs.bootstrap.session";

function readCachedDocsBootstrap(): DocsAppBootstrap | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(DOCS_BOOTSTRAP_CACHE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as DocsAppBootstrap["session"];
    return { session, data: { document: null } };
  } catch {
    return null;
  }
}

/**
 * Send what was queued offline first, on every Docs page (not only Docs
 * home): the Docs outbox (editor creates) and the Drive outbox (Docs home
 * writes, #2063 C4); bodies typed offline in documents since closed upload
 * alongside. Then bring the file tree up to date (FileNode/changes; shared with the
 * pull Docs home starts) and fetch the changed bodies the tree names.
 */
async function sendQueuedThenSyncBodies(username: string, signal?: AbortSignal): Promise<void> {
  let uploads: Promise<void> = Promise.resolve();
  if (readBrowserOnline()) {
    await getDocsSyncRunner(username).flush();
    await getDriveSyncRunner(username).flush();
    // Each body upload holds its room's lock, which body sync skips, so the
    // pull and the fetch of other bodies need not wait for slow saves.
    uploads = uploadPendingDocBodies(username).catch(() => undefined);
  }
  try {
    if (signal?.aborted) return;
    if (!wgwIsGuestSession()) {
      const pulled = await syncDriveInboundFromFileNodes(username, { signal });
      if (pulled.changed || pulled.listedChanges) notifyDriveRemoteChange(username);
    }
    if (signal?.aborted) return;
    await requestDocsBodySyncFromTree(username, { signal });
  } finally {
    await uploads;
  }
}

function cacheDocsBootstrap(bootstrap: DocsAppBootstrap): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(DOCS_BOOTSTRAP_CACHE_KEY, JSON.stringify(bootstrap.session));
  } catch {
    // Ignore cache write failures (private mode/quota).
  }
}

export function useDocsAPI(source?: DocsApiSource) {
  const resolvedSource = useMemo(() => source ?? createDefaultDocsApiSource(), [source]);
  const placeholderData = useMemo<DocsUIData>(() => ({ document: null }), []);

  const runBootstrap = useCallback(async () => {
    const bootstrap = await resolvedSource.loadBootstrap();
    cacheDocsBootstrap(bootstrap);
    return bootstrap;
  }, [resolvedSource]);
  const readCache = useCallback(async () => readCachedDocsBootstrap(), []);

  const { phase, error, data, load, successVersion } = useHybridBootstrap({
    load: runBootstrap,
    readCache,
  });

  const networkOperations = useMemo(
    () => resolvedSource.createNetworkOperations(),
    [resolvedSource],
  );
  const offlineUsername = resolveDocsOfflineUsername(data?.session.user.username);

  useEffect(() => {
    if (phase !== "ready" || !offlineUsername) return;
    const controller = new AbortController();
    void sendQueuedThenSyncBodies(offlineUsername, controller.signal).catch(() => undefined);
    return () => controller.abort();
  }, [offlineUsername, phase]);

  useEffect(() => {
    if (phase !== "ready" || !offlineUsername) return;
    const controller = new AbortController();
    return subscribeOfflineDeviceContentSettings(() => {
      void requestDocsBodySyncFromTree(offlineUsername, { signal: controller.signal });
    });
  }, [offlineUsername, phase]);

  // A Doc the tree learns later (a push, another tab's pull) gets its body too.
  useEffect(() => {
    if (phase !== "ready" || !offlineUsername) return undefined;
    return subscribeDriveRemoteChanges(offlineUsername, () => {
      void requestDocsBodySyncFromTree(offlineUsername);
    });
  }, [offlineUsername, phase]);

  useOnReconnect(
    useCallback(() => {
      if (!offlineUsername) return;
      void sendQueuedThenSyncBodies(offlineUsername).catch(() => undefined);
    }, [offlineUsername]),
  );

  return {
    phase,
    error,
    retry: load,
    successVersion,
    session: data?.session ?? mockWorkspaceSession,
    data: data?.data ?? placeholderData,
    networkOperations,
  };
}
