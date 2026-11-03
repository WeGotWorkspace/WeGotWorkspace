import { useCallback, useEffect, useMemo } from "react";
import { useOnReconnect } from "@/hooks/use-connectivity";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import { useHybridBootstrap } from "@/lib/live/use-hybrid-bootstrap";
import { readBrowserOnline } from "@/lib/offline/core/browser-online";
import { subscribeOfflineDeviceContentSettings } from "@/lib/offline/core/offline-device-settings";
import { syncDocsBodiesFromHomeListing } from "@/lib/offline/docs/docs-body-sync";
import { getDocsSyncRunner } from "@/lib/offline/docs/docs-hybrid-operations";
import { resolveDocsOfflineUsername } from "@/lib/offline/offline-session";
import type { DocsAppBootstrap, DocsUIData } from "@/docs-core/src/docs-types";
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
 * Send what was queued offline first, on every Docs page (not only the home
 * listing), then bodies typed offline in documents since closed, so the
 * listing synced next already shows those changes.
 */
async function sendQueuedThenSyncBodies(username: string, signal?: AbortSignal): Promise<void> {
  if (readBrowserOnline()) {
    await getDocsSyncRunner(username).flush();
    await uploadPendingDocBodies(username);
  }
  if (signal?.aborted) return;
  await syncDocsBodiesFromHomeListing(username, { signal });
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
      void syncDocsBodiesFromHomeListing(offlineUsername, { signal: controller.signal }).catch(
        () => undefined,
      );
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
