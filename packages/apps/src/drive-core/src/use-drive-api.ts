import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOnReconnect } from "@/hooks/use-connectivity";
import { mockWorkspaceSession } from "@/lib/api/mock/workspace-session-mock";
import { wgwIsGuestSession, wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import { useHybridBootstrap } from "@/lib/live/use-hybrid-bootstrap";
import {
  createDefaultDriveApiSource,
  type DriveApiSource,
} from "@/drive-core/src/drive-api-source";
import type { DriveAppBootstrap, DriveUIData } from "@/lib/files/drive-types";
import { subscribeOfflineDeviceContentSettings } from "@/lib/offline/core/offline-device-settings";
import { syncDocsBodiesFromHomeListing } from "@/lib/offline/docs/docs-body-sync";
import { listAllCachedDriveEntryPaths } from "@/lib/offline/drive/drive-directory-offline-store";
import { syncAllDriveContentFromCache } from "@/lib/offline/drive/drive-content-sync";
import {
  createHybridDriveOperations,
  flushDriveOutboxForAccount,
} from "@/lib/offline/drive/drive-hybrid-operations";
import { syncDriveMetadataTree } from "@/lib/offline/drive/drive-metadata-sync";
import {
  guestUploadQueueOperations,
  resolveGuestUploadAccount,
} from "@/lib/offline/drive/upload/drive-upload-guest";
import { startDriveUploader } from "@/lib/offline/drive/upload/drive-upload-runner";
import {
  readDriveBootstrapFromCache,
  writeDriveBootstrapToCache,
} from "@/lib/offline/drive/drive-directory-offline-store";
import {
  rememberOfflineDriveUsername,
  resolveDriveOfflineUsername,
} from "@/lib/offline/core/offline-session";

const DRIVE_BOOTSTRAP_SESSION_KEY = "wgw.drive.bootstrap.session";
const GUEST_ACCOUNT_RETRY_BASE_MS = 2_000;
const GUEST_ACCOUNT_RETRY_MAX_MS = 30_000;
const GUEST_ACCOUNT_MAX_BACKOFF_RETRIES = 6;

function readCachedDriveSession(): DriveAppBootstrap["session"] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(DRIVE_BOOTSTRAP_SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as DriveAppBootstrap["session"];
  } catch {
    return null;
  }
}

function cacheDriveSession(session: DriveAppBootstrap["session"]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(DRIVE_BOOTSTRAP_SESSION_KEY, JSON.stringify(session));
  } catch {
    // Ignore cache write failures.
  }
}

async function runDriveOfflineSync(
  username: string,
  bootstrap: DriveAppBootstrap,
  signal?: AbortSignal,
): Promise<void> {
  await syncDriveMetadataTree(username, bootstrap, { signal });
  const filePaths = await listAllCachedDriveEntryPaths(username);
  await syncAllDriveContentFromCache(username, filePaths, { signal });
  await syncDocsBodiesFromHomeListing(username, { signal });
}

export function useDriveAPI(source?: DriveApiSource) {
  const resolvedSource = useMemo(() => source ?? createDefaultDriveApiSource(), [source]);
  const placeholderData = useMemo<DriveUIData>(
    () => ({
      user: { username: "", name: "", role: "user", roots: ["/users"] },
      cwd: "/",
      directory: { location: "/", files: [] },
    }),
    [],
  );
  const liveEnabled = wgwLiveApiEnabled();
  const bootstrapRef = useRef<DriveAppBootstrap | null>(null);

  const runBootstrap = useCallback(async () => {
    const bootstrap = await resolvedSource.loadBootstrap();
    bootstrapRef.current = bootstrap;
    cacheDriveSession(bootstrap.session);
    if (liveEnabled && !wgwIsGuestSession()) {
      const accountUsername = bootstrap.session.user.username;
      if (accountUsername) {
        await writeDriveBootstrapToCache(accountUsername, bootstrap);
        rememberOfflineDriveUsername(accountUsername);
      }
    }
    return bootstrap;
  }, [liveEnabled, resolvedSource]);

  const readCache = useCallback(async (): Promise<DriveAppBootstrap | null> => {
    const session = readCachedDriveSession();
    if (!session) return null;
    const accountUsername = session.user.username;
    if (!accountUsername) return { session, data: placeholderData };
    const cached = await readDriveBootstrapFromCache(accountUsername);
    if (cached) return cached;
    return { session, data: placeholderData };
  }, [placeholderData]);

  const { phase, error, data, load, successVersion } = useHybridBootstrap({
    load: runBootstrap,
    readCache,
  });

  const offlineUsername = resolveDriveOfflineUsername(data?.session.user.username);
  const syncGenerationRef = useRef(0);

  const triggerOfflineSync = useCallback((username: string, bootstrap: DriveAppBootstrap) => {
    const generation = syncGenerationRef.current + 1;
    syncGenerationRef.current = generation;
    const controller = new AbortController();
    void runDriveOfflineSync(username, bootstrap, controller.signal)
      .then(() => flushDriveOutboxForAccount(username))
      .catch(() => undefined);
    return () => {
      if (syncGenerationRef.current === generation) {
        controller.abort();
      }
    };
  }, []);

  useEffect(() => {
    if (wgwIsGuestSession() || phase !== "ready" || !offlineUsername || !data) return;
    bootstrapRef.current = data;
    return triggerOfflineSync(offlineUsername, data);
  }, [data, offlineUsername, phase, successVersion, triggerOfflineSync]);

  useEffect(() => {
    // Resume queued uploads on app start. The uploader outlives this view on purpose.
    if (!liveEnabled || wgwIsGuestSession() || !offlineUsername || phase !== "ready") return;
    startDriveUploader(offlineUsername);
  }, [liveEnabled, offlineUsername, phase]);

  const guestUploadAccount = useGuestUploadAccount(liveEnabled && phase === "ready");

  useEffect(() => {
    if (wgwIsGuestSession() || !offlineUsername || phase !== "ready" || !data) return;
    return subscribeOfflineDeviceContentSettings(() => {
      triggerOfflineSync(offlineUsername, data);
    });
  }, [data, offlineUsername, phase, triggerOfflineSync]);

  useOnReconnect(
    useCallback(() => {
      if (wgwIsGuestSession() || !offlineUsername || !data) return;
      triggerOfflineSync(offlineUsername, data);
    }, [data, offlineUsername, triggerOfflineSync]),
  );

  const operations = useMemo(() => {
    if (!liveEnabled || !offlineUsername || wgwIsGuestSession()) {
      const plain = resolvedSource.createOperations(data ?? undefined);
      if (!plain || !guestUploadAccount || !data) return plain;
      return { ...plain, ...guestUploadQueueOperations(guestUploadAccount, data.data.user) };
    }
    return createHybridDriveOperations(offlineUsername, data ?? undefined);
  }, [data, guestUploadAccount, liveEnabled, offlineUsername, resolvedSource]);

  const shareOperations = useMemo(
    () => resolvedSource.createShareOperations(data ?? undefined),
    [data, resolvedSource],
  );

  const listLoading = phase === "loading";

  return {
    phase,
    error,
    retry: load,
    successVersion,
    listLoading,
    session: data?.session ?? mockWorkspaceSession,
    data: data?.data ?? placeholderData,
    operations,
    shareOperations,
    offlineUsername,
  };
}

/**
 * A share-link guest's upload account (#1715), once the live API says the
 * link allows uploads; null otherwise and for members. Starts the guest's
 * uploader, which resumes what this session queued before a reload.
 */
function useGuestUploadAccount(ready: boolean): string | null {
  const [account, setAccount] = useState<string | null>(null);
  // Bumped to ask again after a transient failure (reconnect, or backoff while online).
  const [attempt, setAttempt] = useState(0);
  const retryRef = useRef<() => void>(() => undefined);
  retryRef.current = () => setAttempt((value) => value + 1);

  useEffect(() => {
    if (!ready || !wgwIsGuestSession()) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    resolveGuestUploadAccount().then(
      (resolved) => {
        if (!active) return;
        setAccount(resolved);
        if (resolved) startDriveUploader(resolved);
      },
      () => {
        if (!active) return;
        const delay = Math.min(
          GUEST_ACCOUNT_RETRY_BASE_MS * 2 ** attempt,
          GUEST_ACCOUNT_RETRY_MAX_MS,
        );
        if (attempt < GUEST_ACCOUNT_MAX_BACKOFF_RETRIES) {
          timer = setTimeout(() => retryRef.current(), delay);
        }
      },
    );
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [ready, attempt]);

  useOnReconnect(
    useCallback(() => {
      if (ready && wgwIsGuestSession()) setAttempt((value) => value + 1);
    }, [ready]),
  );
  return account;
}
