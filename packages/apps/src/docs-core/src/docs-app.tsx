import { moveDocsPageSetupOverride, startDocWithDefaultPageSetup } from "@/lib/docs-page-setup";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useOnReconnect } from "@/hooks/use-connectivity";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useAppToast } from "@/hooks/use-app-toast";
import { WorkspaceLiveAppShell } from "@/lib/live/workspace-live-app-shell";
import { docsSearchFromApiPath, parseDocsRouteSearch } from "@/docs-core/src/docs-route-search";
import { useDocsRouteDocument } from "@/docs-core/src/use-docs-route-document";
import { DocsRouteStatus } from "@/docs-core/src/docs-route-status";
import { docsSessionKnown } from "@/docs-core/src/docs-session-known";
import { useOpenDocsFile } from "@/docs-core/src/use-open-docs-file";
import {
  isAccessTokenExpired,
  wgwCompleteLogoutNavigation,
  wgwCurrentAccessToken,
  wgwEnsureFreshAccessToken,
  wgwIsGuestSession,
  wgwLiveApiEnabled,
} from "@/lib/api/wgw/http";
import { buildDocsEditorUrls } from "@/docs-core/src/docs-collab-urls";
import type { DocsAppProps } from "@/docs-core/src/docs-app-props";
import { isDocsCollabEditablePath } from "@/lib/files/docs-collab-text-files";
import { docsLabels } from "@/docs-core/src/docs-labels";
import { fileNameToBrowserTitle, useDocumentTitle } from "@/lib/document-title";
import { DocsWorkspace } from "@/docs-core/src/docs-workspace";
import { DocxImportReportForDoc } from "@/docs-core/src/docx-import/docx-import-dialogs";
import { DocsHomeWorkspace } from "@/docs-core/src/docs-home-workspace";
import { DocsCollabWorkspace, useDocsCollabPendingSync } from "@/text-editor-core/docs-collab";
import { useDocsFileRename } from "@/docs-core/src/use-docs-file-rename";
import { createWgwDocsCollabWire } from "@/docs-core/src/docs-collab-wgw-wire";
import { useDocsAPI } from "@/docs-core/src/use-docs-api";
import { createWgwDriveOperations } from "@/lib/api/wgw/drive";
import { createWgwDriveShareOperations } from "@/lib/api/wgw/drive-shares";
import { createMockDriveShareOperations } from "@/lib/api/mock/drive-share-mock";
import { mocksInBuild } from "@/lib/api/create-workspace-source";
import { getConnectivitySnapshot } from "@/lib/offline/core/browser-online";
import { queueNewDocsOfflineDocument } from "@/lib/offline/docs/docs-offline-pin-core";
import { useDriveFileNodeInbound } from "@/lib/offline/drive/use-drive-file-node-inbound";
import { useDocsEditorPathFollow } from "@/docs-core/src/use-docs-editor-path-follow";
import { resolveDocsOfflineUsername } from "@/lib/offline/offline-session";
import { useOfflinePendingToast } from "@/lib/offline/use-offline-sync-toast";
import { useDriveShareDialog } from "@/drive-core/src/use-drive-share-dialog";
import { useDriveShareMyRights } from "@/drive-core/src/use-drive-share-my-rights";
import { resolveDocsCollabPermissionsWhileLoading } from "@/docs-core/src/docs-collab-permissions";
import { ShareDialog } from "@/share-ui/share-dialog";
import { useNotificationsMarkReadOnConsume } from "@/notifications-core/src/use-notifications-mark-read-on-consume";

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

  const routeSearch = useMemo(
    () => parseDocsRouteSearch(search as Record<string, unknown>),
    [search],
  );
  const isGuestSession = wgwIsGuestSession();
  const offlineUsername = resolveDocsOfflineUsername(session.user.username);
  const [editorInboundKey, setEditorInboundKey] = useState(0);
  // Mirrors `holdServerSave` below: while saves are held, a `?file=` link is not swapped for an id.
  const [holdPathLookup, setHoldPathLookup] = useState(false);
  const {
    document: routeDocument,
    followPath,
    retry: retryRouteDocument,
    relocate: relocateRouteDocument,
  } = useDocsRouteDocument({
    search: routeSearch,
    canResolve: wgwLiveApiEnabled() && !isGuestSession,
    username: offlineUsername,
    refreshKey: editorInboundKey,
    holdPathLookup,
  });
  const filePath = routeDocument.status === "ready" ? routeDocument.path : null;
  const fileNodeId = routeDocument.status === "ready" ? routeDocument.nodeId : undefined;
  const onDocumentRoute = routeDocument.status !== "home";
  useDriveFileNodeInbound(onDocumentRoute ? offlineUsername : undefined, editorInboundKey);
  useOnReconnect(
    useCallback(() => {
      if (!onDocumentRoute) return;
      setEditorInboundKey((key) => key + 1);
    }, [onDocumentRoute]),
  );
  const followMovedFile = useCallback(
    (apiPath: string) => {
      // Opened by id: the id stays, only its path changes. By path: open the new path.
      if (fileNodeId) void followPath(apiPath);
      else void navigate({ to: "/docs", search: docsSearchFromApiPath(apiPath), replace: true });
    },
    [fileNodeId, followPath, navigate],
  );
  const { holdServerSave, holdUntilChecked } = useDocsEditorPathFollow({
    username: offlineUsername,
    filePath,
    onFollow: followMovedFile,
  });
  useEffect(() => setHoldPathLookup(holdServerSave), [holdServerSave]);

  useNotificationsMarkReadOnConsume({
    docsApiPath: filePath,
  });

  const handleLogout = useCallback(() => {
    if (wgwIsGuestSession()) {
      void wgwCompleteLogoutNavigation();
      return;
    }
    window.location.assign("/logout");
  }, []);

  const handleFileRenamed = useCallback(
    (apiPath: string) => {
      if (filePath) moveDocsPageSetupOverride(filePath, apiPath);
      void followPath(apiPath);
    },
    [filePath, followPath],
  );

  const handleOpenHomeFile = useOpenDocsFile({
    canOpenById: wgwLiveApiEnabled() && !isGuestSession,
    username: offlineUsername,
    holdPathLookup,
  });

  const driveOperations = useMemo(() => createWgwDriveOperations("/"), []);

  const collabRename = useDocsFileRename({
    apiPath: filePath,
    operations: driveOperations,
    onRenamed: handleFileRenamed,
  });

  const shareOperations = useMemo(
    () =>
      mocksInBuild && !wgwLiveApiEnabled()
        ? createMockDriveShareOperations()
        : createWgwDriveShareOperations(),
    [],
  );

  const collabShareDialog = useDriveShareDialog({
    shareOperations,
    username: session.user.username ?? "",
  });

  const showCollab = isDocsCollabEditablePath(filePath) && !isGuestSession;
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
        startDocWithDefaultPageSetup(apiPath);
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
    return {
      ...buildDocsEditorUrls(filePath, fileNodeId),
      authToken: collabAuthToken,
      // Held on this device while the server does not have this path yet, or may have moved it.
      roomNotPersistent: holdServerSave,
      roomHeldUntilChecked: holdUntilChecked,
      onPersistForbidden: () => {
        showError(docsLabels.accessLostTitle, { description: docsLabels.accessLostMessage });
      },
      // A save to the old path after a rename elsewhere: look up where the id lives now.
      onDocumentGone: relocateRouteDocument,
    };
  }, [
    collabAuthToken,
    fileNodeId,
    filePath,
    holdServerSave,
    holdUntilChecked,
    relocateRouteDocument,
    showCollab,
    showError,
  ]);
  const pendingCollabSync = useDocsCollabPendingSync(showCollab ? collabUrls?.room : null);
  const collabWire = useMemo(() => createWgwDocsCollabWire(), []);

  useOfflinePendingToast(pendingCollabSync, docsLabels.toastSynced, showCollab, collabUrls?.room);

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
          {/* Shown once when a Doc made by Save as Markdown opens (#1983). */}
          {filePath ? (
            <DocxImportReportForDoc docPath={filePath} surfaceClassName="docs-dialog-surface" />
          ) : null}
          {routeDocument.status === "resolving" || routeDocument.status === "not-found" ? (
            <DocsRouteStatus document={routeDocument} onRetry={retryRouteDocument} />
          ) : filePath === null ? (
            <DocsHomeWorkspace
              session={session}
              offlineUsername={resolveDocsOfflineUsername(session.user.username)}
              operations={driveOperations}
              shareOperations={shareOperations}
              onOpenFile={handleOpenHomeFile}
              // Guests cannot save a new document yet (#1713).
              onCreateDocument={isGuestSession ? undefined : handleCreateHomeDocument}
              onLogout={handleLogout}
            />
          ) : showCollab && !docsSessionKnown(phase, session.user.username) ? (
            // Join the room once, under the person's own name (#2056).
            <DocsRouteStatus document={{ status: "resolving" }} onRetry={retryRouteDocument} />
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
                driveOperations={driveOperations}
                driveUsername={session.user.username}
                docApiPath={filePath}
                onRename={collabRename.open}
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
              {collabRename.dialog}
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
