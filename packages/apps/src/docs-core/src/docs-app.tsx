import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useAppToast } from "@/hooks/use-app-toast";
import { WorkspaceLiveAppShell } from "@/lib/live/workspace-live-app-shell";
import {
  docsApiPathFromSearch,
  docsSearchFromApiPath,
  openDocsFileInNewWindow,
  parseDocsRouteSearch,
} from "@/docs-core/src/docs-route-search";
import {
  wgwApiBaseUrl,
  wgwCompleteLogoutNavigation,
  wgwEnsureFreshAccessToken,
  wgwIsGuestSession,
  wgwLiveApiEnabled,
} from "@/lib/api/wgw/http";
import { encodeFileRoomId } from "@/lib/rtc/room-id";
import type { DocsAppProps } from "@/docs-core/src/docs-app-props";
import { isDocsCollabEditablePath } from "@/docs-core/src/docs-collab-text-files";
import { docsLabels } from "@/docs-core/src/docs-labels";
import { fileNameToBrowserTitle, useDocumentTitle } from "@/lib/document-title";
import { DocsWorkspace } from "@/docs-core/src/docs-workspace";
import { DocsHomeWorkspace } from "@/docs-core/src/docs-home-workspace";
import { DocsCollabWorkspace, useDocsCollabPendingSync } from "@/text-editor-core/docs-collab";
import { createWgwDocsCollabWire } from "@/docs-core/src/docs-collab-wgw-wire";
import { useDocsAPI } from "@/docs-core/src/use-docs-api";
import { createWgwDriveOperations } from "@/lib/api/wgw/drive";
import { createWgwDriveShareOperations } from "@/lib/api/wgw/drive-shares";
import { createMockDriveShareOperations } from "@/lib/api/mock/drive-share-mock";
import { getConnectivitySnapshot } from "@/lib/offline/core/browser-online";
import { queueNewDocsOfflineDocument } from "@/lib/offline/docs/docs-offline-pin-core";
import { resolveDocsOfflineUsername } from "@/lib/offline/offline-session";
import { useOfflinePendingToast } from "@/lib/offline/use-offline-sync-toast";
import { driveSearchFromView } from "@/drive-core/src/drive-route-search";
import type { ViewKey } from "@/drive-core/src/drive-models";
import { useDriveShareDialog } from "@/drive-core/src/use-drive-share-dialog";
import { useDriveShareMayShare } from "@/drive-core/src/use-drive-share-may-share";
import { ShareDialog } from "@/share-ui/share-dialog";

function buildDriveAccessHref(view: ViewKey): string | null {
  if (view.type !== "access") return null;
  const search = driveSearchFromView(view);
  const params = new URLSearchParams();
  if (search.view) params.set("view", search.view);
  if (search.path) params.set("path", search.path);
  const qs = params.toString();
  return `/drive${qs ? `?${qs}` : ""}`;
}

function DocsCollabDocumentTitle({ fileName }: { fileName: string }) {
  useDocumentTitle(fileNameToBrowserTitle(fileName));
  return null;
}

export function DocsApp({ apiSource }: DocsAppProps = {}) {
  const navigate = useNavigate();
  const { showError } = useAppToast();
  const search = useSearch({ strict: false });

  const { phase, error, retry, successVersion, session, data, networkOperations } =
    useDocsAPI(apiSource);

  const filePath = useMemo(
    () => docsApiPathFromSearch(parseDocsRouteSearch(search as Record<string, unknown>).file),
    [search],
  );

  const handleLogout = useCallback(() => {
    if (wgwIsGuestSession()) {
      void wgwCompleteLogoutNavigation();
      return;
    }
    window.location.assign("/logout");
  }, []);

  const handleFileRenamed = useCallback(
    (apiPath: string) => {
      void navigate({
        to: "/docs",
        search: docsSearchFromApiPath(apiPath),
      });
    },
    [navigate],
  );

  const handleOpenHomeFile = useCallback((apiPath: string) => {
    openDocsFileInNewWindow(apiPath);
  }, []);

  const driveOperations = useMemo(() => createWgwDriveOperations("/"), []);

  const shareOperations = useMemo(
    () =>
      wgwLiveApiEnabled() ? createWgwDriveShareOperations() : createMockDriveShareOperations(),
    [],
  );

  const handleNavigate = useCallback(
    (href: string) => {
      try {
        const url = new URL(href, window.location.origin);
        if (url.pathname === "/drive") {
          const view = url.searchParams.get("view") ?? undefined;
          const path = url.searchParams.get("path") ?? undefined;
          const search: Record<string, string | undefined> = {};
          if (view) search.view = view;
          if (path) search.path = path;
          void navigate({
            to: "/drive",
            search,
          });
          return;
        }
      } catch {
        // Fall through to full navigation.
      }
      window.location.assign(href);
    },
    [navigate],
  );

  const handleShareViewChange = useCallback(
    (view: ViewKey) => {
      const href = buildDriveAccessHref(view);
      if (href) handleNavigate(href);
    },
    [handleNavigate],
  );

  const collabShareDialog = useDriveShareDialog({
    shareOperations,
    username: session.user.username ?? "",
    onViewChange: handleShareViewChange,
  });

  const showCollab = isDocsCollabEditablePath(filePath) && !wgwIsGuestSession();
  const { mayShare: collabMayShare } = useDriveShareMayShare({
    path: filePath ?? "",
    operations: shareOperations,
    enabled: Boolean(shareOperations && filePath?.trim() && showCollab),
  });

  const handleCreateHomeDocument = useCallback(
    (apiPath: string) => {
      void (async () => {
        const offlineUsername = resolveDocsOfflineUsername(session.user.username);
        try {
          if (offlineUsername && !getConnectivitySnapshot()) {
            await queueNewDocsOfflineDocument(offlineUsername, apiPath);
          } else {
            await networkOperations.saveFile(apiPath, "");
          }
        } catch {
          showError(docsLabels.homeCreateError);
          return;
        }
        void navigate({
          to: "/docs",
          search: docsSearchFromApiPath(apiPath),
        });
      })();
    },
    [navigate, networkOperations, session.user.username, showError],
  );

  const [collabAuthToken, setCollabAuthToken] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!showCollab || !filePath) {
      setCollabAuthToken(undefined);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const token = await wgwEnsureFreshAccessToken();
        if (!cancelled) {
          setCollabAuthToken(token ?? undefined);
        }
      } catch {
        if (!cancelled) {
          setCollabAuthToken(undefined);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filePath, showCollab]);

  const collabUrls = useMemo(() => {
    if (!showCollab || !filePath) return undefined;
    const baseUrl = wgwApiBaseUrl();
    const room = filePath.replace(/^\/+/, "");
    const roomId = encodeFileRoomId(`/${room}`);
    const pathQuery = encodeURIComponent(room);
    return {
      signalUrl: `${baseUrl}/rooms/${encodeURIComponent(roomId)}/events`,
      collabApiBaseUrl: `${baseUrl}/rooms`,
      collabRtcUrl: `${baseUrl}/rooms/${encodeURIComponent(roomId)}/configuration`,
      authToken: collabAuthToken,
      documentUrl: `${baseUrl}/files/collaboration?path=${pathQuery}`,
      yjsUrl: `${baseUrl}/files/collaboration?path=${pathQuery}&format=yjs`,
      documentSaveMethod: "PUT" as const,
      room,
    };
  }, [collabAuthToken, filePath, showCollab]);
  const pendingCollabSync = useDocsCollabPendingSync(showCollab ? collabUrls?.room : null);
  const collabWire = useMemo(() => createWgwDocsCollabWire(), []);

  useOfflinePendingToast(pendingCollabSync, docsLabels.toastSynced, showCollab);

  const collabUserName = session.user.displayName || session.user.username || "User";
  const collabDocumentTitle = useMemo(() => {
    if (!filePath) return undefined;
    const normalized = filePath.replace(/\/+$/, "");
    const slash = normalized.lastIndexOf("/");
    return slash >= 0 ? normalized.slice(slash + 1) : normalized;
  }, [filePath]);

  return (
    <WorkspaceLiveAppShell
      phase={phase}
      error={error}
      retry={retry}
      errorTitle="Could not load docs"
      successVersion={successVersion}
      render={() => (
        <div>
          {filePath === null ? (
            <DocsHomeWorkspace
              session={session}
              offlineUsername={resolveDocsOfflineUsername(session.user.username)}
              operations={driveOperations}
              onOpenFile={handleOpenHomeFile}
              onCreateDocument={handleCreateHomeDocument}
              onLogout={handleLogout}
            />
          ) : showCollab && collabUrls ? (
            <>
              {phase === "ready" && collabDocumentTitle ? (
                <DocsCollabDocumentTitle fileName={collabDocumentTitle} />
              ) : null}
              <DocsCollabWorkspace
                userName={collabUserName}
                documentTitle={collabDocumentTitle}
                urls={collabUrls}
                wire={collabWire}
                onLogout={handleLogout}
                showShare={collabMayShare === true}
                shareLabel={docsLabels.share}
                onShare={
                  filePath
                    ? () =>
                        collabShareDialog.openShareDialog(
                          filePath,
                          collabDocumentTitle ?? undefined,
                        )
                    : undefined
                }
              />
              {shareOperations ? (
                <ShareDialog
                  path={collabShareDialog.shareDialog.path}
                  title={collabShareDialog.shareDialog.title}
                  open={collabShareDialog.shareDialog.open}
                  onOpenChange={collabShareDialog.handleShareDialogOpenChange}
                  onOpenAccess={collabShareDialog.handleShareDialogOpenAccess}
                  shareOperations={shareOperations}
                  dialogSurfaceClassName="docs-dialog-surface"
                />
              ) : null}
            </>
          ) : (
            <DocsWorkspace
              data={data}
              session={session}
              operations={networkOperations}
              shareOperations={shareOperations}
              filePath={filePath}
              onLogout={handleLogout}
              onFileRenamed={handleFileRenamed}
              onNavigate={handleNavigate}
            />
          )}
        </div>
      )}
    />
  );
}
