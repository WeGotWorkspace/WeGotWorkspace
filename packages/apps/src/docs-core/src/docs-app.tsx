import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useAppToast } from "@/hooks/use-app-toast";
import { WorkspaceLiveAppShell } from "@/lib/live/workspace-live-app-shell";
import {
  docsApiPathFromSearch,
  docsSearchFromApiPath,
  parseDocsRouteSearch,
} from "@/docs-core/src/docs-route-search";
import { useOpenDocsFile } from "@/docs-core/src/use-open-docs-file";
import {
  isAccessTokenExpired,
  wgwApiBaseUrl,
  wgwCompleteLogoutNavigation,
  wgwCurrentAccessToken,
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
import { useDriveShareDialog } from "@/drive-core/src/use-drive-share-dialog";
import { useDriveShareMyRights } from "@/drive-core/src/use-drive-share-my-rights";
import { resolveDocsCollabPermissionsWhileLoading } from "@/docs-core/src/docs-collab-permissions";
import { ShareDialog } from "@/share-ui/share-dialog";

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

  const handleOpenHomeFile = useOpenDocsFile();

  const driveOperations = useMemo(() => createWgwDriveOperations("/"), []);

  const shareOperations = useMemo(
    () =>
      wgwLiveApiEnabled() ? createWgwDriveShareOperations() : createMockDriveShareOperations(),
    [],
  );

  const collabShareDialog = useDriveShareDialog({
    shareOperations,
    username: session.user.username ?? "",
  });

  const showCollab = isDocsCollabEditablePath(filePath) && !wgwIsGuestSession();
  const {
    myRights: collabMyRights,
    mayShare: collabMayShare,
    loading: collabRightsLoading,
  } = useDriveShareMyRights({
    path: filePath ?? "",
    operations: shareOperations,
    enabled: Boolean(shareOperations && filePath?.trim() && showCollab),
  });
  const collabPermissions = resolveDocsCollabPermissionsWhileLoading(
    collabMyRights
      ? {
          mayEditContent: collabMyRights.mayEditContent,
          mayComment: collabMyRights.mayComment,
          mayReview: collabMyRights.mayReview,
        }
      : null,
    Boolean(shareOperations && filePath?.trim() && showCollab) && collabRightsLoading,
  );

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

  const [collabAuthToken, setCollabAuthToken] = useState<string | undefined>(() => {
    const cached = wgwCurrentAccessToken();
    return cached && !isAccessTokenExpired() ? cached : undefined;
  });

  useEffect(() => {
    if (!showCollab || !filePath) {
      setCollabAuthToken(undefined);
      return;
    }
    const cached = wgwCurrentAccessToken();
    if (cached && !isAccessTokenExpired()) {
      setCollabAuthToken(cached);
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
  }, [filePath, phase, showCollab]);

  const collabUrls = useMemo(() => {
    if (!showCollab || !filePath) return undefined;
    const baseUrl = wgwApiBaseUrl();
    const room = filePath.replace(/^\/+/, "");
    const roomId = encodeFileRoomId(room);
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
              shareOperations={shareOperations}
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
                permissions={collabPermissions}
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
            />
          )}
        </div>
      )}
    />
  );
}
