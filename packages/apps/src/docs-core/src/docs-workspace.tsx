import { useCallback, useEffect, useMemo, useState } from "react";
import type { Editor } from "@tiptap/react";
import { Pencil, Printer, Users } from "lucide-react";
import { TooltipProvider } from "@/ui/tooltip";
import { AppSidebar } from "@/app-sidebar/src/app-sidebar";
import { WorkspaceAppLayout } from "@/workspace-shell/src/workspace-app-layout";
import {
  workspaceUserFooterDetailLine,
  type WorkspaceSession,
} from "@/lib/workspace/workspace-session";
import { wgwIsGuestSession, wgwRedirectGuestShareReauth } from "@/lib/api/wgw/http";
import { ViewHeader } from "@/view-header/src/view-header";
import { printTextEditorSheet } from "@/text-editor-core/src/text-editor-print";
import { cn } from "@/lib/utils";
import { WorkspaceSidebarAccountFooter } from "@/workspace-shell/src/workspace-app-layout";
import { useDriveShareDialog } from "@/drive-core/src/use-drive-share-dialog";
import { useDriveShareMyRights } from "@/drive-core/src/use-drive-share-my-rights";
import { DocsHeaderActions } from "@/docs-core/src/docs-header-actions";
import { docsDownloadHeaderAction } from "@/docs-core/src/docs-download-action";
import { useDocsDownload } from "@/docs-core/src/use-docs-download";
import { DocsFooterTools } from "@/docs-core/src/docs-footer-tools";
import { IconButton } from "@/button/src/button";
import { DocsMainPane } from "@/docs-core/src/docs-main-pane";
import { useDocsPageSetup } from "@/lib/use-docs-page-setup";
import type { TextEditorPageSetup } from "@/lib/page-format";
import { DocsOutlineSidebar } from "@/docs-core/src/docs-outline-sidebar";
import { DocsWorkspaceModals } from "@/docs-core/src/docs-workspace-modals";
import { focusOutlineHeading, parseMarkdownOutline } from "@/docs-core/src/docs-outline";
import { useDocsController } from "@/docs-core/src/use-docs-controller";
import { fileNameToBrowserTitle, useDocumentTitle } from "@/lib/document-title";
import type { DocsWorkspaceProps } from "@/docs-core/src/docs-workspace-props";
import "@/docs-core/src/docs-workspace.css";

type DocsController = ReturnType<typeof useDocsController>;
type DocsShareDialog = ReturnType<typeof useDriveShareDialog>;

export function DocsWorkspace({
  data,
  session,
  operations,
  shareOperations,
  filePath = null,
  labels,
  onLogout,
  onFileRenamed,
  guestSession,
  className,
}: DocsWorkspaceProps) {
  const isGuestSession = guestSession ?? wgwIsGuestSession();
  const apiPath = filePath ?? data.document?.apiPath ?? "";
  const shareFetchEnabled = Boolean(shareOperations && apiPath.trim() && !isGuestSession);
  const {
    myRights,
    mayShare,
    loading: shareRightsLoading,
  } = useDriveShareMyRights({
    path: apiPath,
    operations: shareOperations,
    enabled: shareFetchEnabled,
  });
  const readOnlyFromShare =
    isGuestSession ||
    (myRights != null ? myRights.mayEditContent !== true : shareFetchEnabled && shareRightsLoading);
  const controller = useDocsController({
    filePath,
    labels,
    operations,
    initialDocument: data.document,
    readOnly: readOnlyFromShare,
    onFileRenamed,
  });

  useEffect(() => {
    if (!controller.loadError || !isGuestSession) return;
    // Password rotation revokes the guest DB session; stale JWT still unlocks the shell.
    wgwRedirectGuestShareReauth();
  }, [controller.loadError, isGuestSession]);

  const shareDialog = useDriveShareDialog({
    shareOperations,
    username: session.user.username ?? "",
  });

  const fileKey = filePath ?? data.document?.apiPath ?? "mock";
  const browserTitleContext =
    controller.title.trim().length > 0
      ? fileNameToBrowserTitle(controller.title)
      : controller.labels.emptyTitle;
  useDocumentTitle(browserTitleContext);

  if (controller.loadError && isGuestSession) {
    return null;
  }

  return (
    <TooltipProvider delayDuration={200}>
      <DocsWorkspaceShell
        className={className}
        controller={controller}
        fileKey={fileKey}
        session={session}
        apiPath={apiPath}
        mayShare={mayShare}
        shareDialog={shareDialog}
        guestView={isGuestSession}
        onLogout={onLogout}
      />
      <DocsWorkspaceModals
        controller={controller}
        shareOperations={shareOperations}
        shareDialog={shareDialog}
      />
    </TooltipProvider>
  );
}

function DocsWorkspaceShell({
  className,
  controller,
  fileKey,
  session,
  apiPath,
  mayShare,
  shareDialog,
  guestView,
  onLogout,
}: {
  className?: string;
  controller: DocsController;
  fileKey: string;
  session: WorkspaceSession;
  apiPath: string;
  mayShare?: boolean;
  shareDialog: DocsShareDialog;
  /** Guests cannot save yet: show the notice and drop editing controls. */
  guestView: boolean;
  onLogout?: () => void;
}) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [viewSource, setViewSource] = useState(false);
  const [activeOutlineIndex, setActiveOutlineIndex] = useState<number | null>(null);
  // Page setup is per document; the "mock" key is a preview without a file.
  const pageSetup = useDocsPageSetup(fileKey === "mock" ? null : fileKey);

  useEffect(() => {
    setViewSource(false);
  }, [fileKey]);

  const outline = useMemo(() => parseMarkdownOutline(controller.content), [controller.content]);

  const handleOutlineSelect = useCallback(
    (index: number) => {
      setActiveOutlineIndex(index);
      if (editor) focusOutlineHeading(editor, index);
    },
    [editor],
  );

  return (
    <WorkspaceAppLayout
      className={cn("docs-workspace", className)}
      sidebar={
        <DocsSidebar
          controller={controller}
          session={session}
          outline={outline}
          activeOutlineIndex={activeOutlineIndex}
          onOutlineSelect={handleOutlineSelect}
          onLogout={onLogout}
        />
      }
      mainHeader={
        <>
          <DocsMainHeader
            controller={controller}
            editor={editor}
            viewSource={viewSource}
            apiPath={apiPath}
            mayShare={mayShare}
            shareDialog={shareDialog}
            guestView={guestView}
            pageSetup={pageSetup.pageSetup}
          />
        </>
      }
      main={
        <DocsMainPane
          controller={controller}
          fileKey={fileKey}
          viewSource={viewSource}
          readOnlyNotice={guestView ? controller.labels.guestReadOnlyNotice : undefined}
          pageSetup={pageSetup.pageSetup}
          onEditorReady={setEditor}
          footerStart={
            controller.hasFile ? (
              <DocsFooterTools
                pageSetup={{ ...pageSetup, labels: controller.labels }}
                source={{
                  checked: viewSource,
                  disabled: !editor,
                  label: controller.labels.sourceSwitch,
                  ariaLabel: viewSource
                    ? controller.labels.hideSource
                    : guestView
                      ? controller.labels.viewSourceReadOnly
                      : controller.labels.viewSource,
                  onToggle: () => setViewSource((on) => !on),
                }}
              />
            ) : null
          }
        />
      }
    />
  );
}

function DocsSidebar({
  controller,
  session,
  outline,
  activeOutlineIndex,
  onOutlineSelect,
  onLogout,
}: {
  controller: DocsController;
  session: WorkspaceSession;
  outline: ReturnType<typeof parseMarkdownOutline>;
  activeOutlineIndex: number | null;
  onOutlineSelect: (index: number) => void;
  onLogout?: () => void;
}) {
  return (
    <AppSidebar
      open={controller.sidebarOpen}
      onCloseMobile={() => controller.setSidebarOpen(false)}
      appSwitchDisabled={wgwIsGuestSession()}
      appSwitchSubtitle="Docs"
      footer={
        <WorkspaceSidebarAccountFooter
          session={session}
          detailLine={workspaceUserFooterDetailLine(session, controller.readOnly)}
          onLogout={onLogout}
        />
      }
    >
      <DocsOutlineSidebar
        labels={controller.labels}
        items={outline}
        activeIndex={activeOutlineIndex}
        onSelect={onOutlineSelect}
        showBackToHome={!controller.readOnly}
      />
    </AppSidebar>
  );
}

function DocsMainHeader({
  controller,
  editor,
  viewSource,
  apiPath,
  mayShare,
  shareDialog,
  guestView,
  pageSetup,
}: {
  controller: DocsController;
  editor: Editor | null;
  viewSource: boolean;
  apiPath: string;
  mayShare?: boolean;
  shareDialog: DocsShareDialog;
  guestView: boolean;
  /** Paper size for the Word download (the page setup control itself is in the footer). */
  pageSetup: TextEditorPageSetup;
}) {
  const title = controller.title || controller.labels.emptyTitle;
  const download = useDocsDownload(editor, title, pageSetup, controller.labels);
  const showShare = Boolean(apiPath.trim() && mayShare === true);

  return (
    <ViewHeader
      title={title}
      sidebarOpen={controller.sidebarOpen}
      onToggleSidebar={() => controller.setSidebarOpen((open) => !open)}
      // Rename sits on the name it changes. Guests have no write route (#1713).
      titleSuffix={
        controller.hasFile && !guestView ? (
          <IconButton
            label={controller.labels.rename}
            icon={<Pencil />}
            size="sm"
            variant="outline"
            className="docs-workspace__rename"
            disabled={!controller.canRename}
            onClick={controller.openRenameDialog}
          />
        ) : undefined
      }
      actions={
        controller.hasFile ? (
          <DocsHeaderActions
            actions={[
              {
                id: "print",
                label: controller.labels.print,
                icon: <Printer />,
                disabled: !editor || viewSource,
                onClick: () => printTextEditorSheet(editor),
              },
              docsDownloadHeaderAction({
                labels: controller.labels,
                download,
                disabled: !editor || viewSource,
              }),
              ...(showShare
                ? [
                    {
                      id: "share",
                      label: controller.labels.share,
                      icon: <Users />,
                      showLabel: true,
                      className: "docs-workspace__share-button",
                      onClick: () => shareDialog.openShareDialog(apiPath, title),
                    },
                  ]
                : []),
            ]}
          />
        ) : null
      }
    />
  );
}
