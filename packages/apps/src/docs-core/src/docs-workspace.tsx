import { useCallback, useEffect, useMemo, useState } from "react";
import type { Editor } from "@tiptap/react";
import { Code2, Pencil, Printer, Share2 } from "lucide-react";
import { TooltipProvider } from "@/ui/tooltip";
import { AppSidebar } from "@/app-sidebar/src/app-sidebar";
import {
  WorkspaceAppLayout,
  WorkspaceUserFooter,
} from "@/workspace-shell/src/workspace-app-layout";
import {
  workspaceUserFooterDetailLine,
  workspaceUserInitials,
  type WorkspaceSession,
} from "@/lib/workspace/workspace-session";
import { wgwIsGuestSession, wgwRedirectGuestShareReauth } from "@/lib/api/wgw/http";
import { ViewHeader } from "@/view-header/src/view-header";
import { printTextEditorSheet } from "@/text-editor-core/src/text-editor-print";
import { cn } from "@/lib/utils";
import { useDriveShareDialog } from "@/drive-core/src/use-drive-share-dialog";
import { useDriveShareMayShare } from "@/drive-core/src/use-drive-share-may-share";
import { DocsHeaderActions } from "@/docs-core/src/docs-header-actions";
import { DocsMainPane } from "@/docs-core/src/docs-main-pane";
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
  className,
}: DocsWorkspaceProps) {
  const isGuestSession = wgwIsGuestSession();
  const controller = useDocsController({
    filePath,
    labels,
    operations,
    initialDocument: data.document,
    readOnly: isGuestSession,
    onFileRenamed,
  });

  useEffect(() => {
    if (!controller.loadError || !isGuestSession) return;
    // Password rotation revokes the guest DB session; stale JWT still unlocks the shell.
    wgwRedirectGuestShareReauth();
  }, [controller.loadError, isGuestSession]);

  const apiPath = filePath ?? data.document?.apiPath ?? "";

  const shareDialog = useDriveShareDialog({
    shareOperations,
    username: session.user.username ?? "",
  });

  const { mayShare } = useDriveShareMayShare({
    path: apiPath,
    operations: shareOperations,
    enabled: Boolean(shareOperations && apiPath.trim() && controller.hasFile && !isGuestSession),
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
  onLogout,
}: {
  className?: string;
  controller: DocsController;
  fileKey: string;
  session: WorkspaceSession;
  apiPath: string;
  mayShare?: boolean;
  shareDialog: DocsShareDialog;
  onLogout?: () => void;
}) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [viewSource, setViewSource] = useState(false);
  const [activeOutlineIndex, setActiveOutlineIndex] = useState<number | null>(null);

  useEffect(() => {
    setViewSource(false);
  }, [fileKey]);

  const outline = useMemo(() => parseMarkdownOutline(controller.content), [controller.content]);

  const handleOutlineSelect = useCallback(
    (index: number) => {
      setActiveOutlineIndex(index);
      if (editor) focusOutlineHeading(editor, index);
      if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) {
        controller.setSidebarOpen(false);
      }
    },
    [controller, editor],
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
            onToggleViewSource={() => setViewSource((on) => !on)}
          />
        </>
      }
      main={
        <DocsMainPane
          controller={controller}
          fileKey={fileKey}
          viewSource={viewSource}
          onEditorReady={setEditor}
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
        <WorkspaceUserFooter
          name={session.user.displayName}
          initials={workspaceUserInitials(session.user)}
          detailLine={workspaceUserFooterDetailLine(session, controller.readOnly)}
          onLogoutClick={onLogout}
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
  onToggleViewSource,
}: {
  controller: DocsController;
  editor: Editor | null;
  viewSource: boolean;
  apiPath: string;
  mayShare?: boolean;
  shareDialog: DocsShareDialog;
  onToggleViewSource: () => void;
}) {
  const title = controller.title || controller.labels.emptyTitle;
  const showShare = Boolean(apiPath.trim() && mayShare === true);

  return (
    <ViewHeader
      title={title}
      titleSize={controller.hasFile ? "sm" : "default"}
      sidebarOpen={controller.sidebarOpen}
      onToggleSidebar={() => controller.setSidebarOpen((open) => !open)}
      actions={
        controller.hasFile ? (
          <DocsHeaderActions
            actions={[
              {
                id: "view-source",
                label: viewSource ? controller.labels.hideSource : controller.labels.viewSource,
                icon: <Code2 />,
                active: viewSource,
                disabled: !editor,
                className: viewSource ? "docs-workspace__source-toggle--active" : undefined,
                onClick: onToggleViewSource,
              },
              {
                id: "print",
                label: controller.labels.print,
                icon: <Printer />,
                disabled: !editor,
                onClick: () => printTextEditorSheet(editor),
              },
              ...(showShare
                ? [
                    {
                      id: "share",
                      label: controller.labels.share,
                      icon: <Share2 />,
                      className: "docs-workspace__share-button",
                      onClick: () => shareDialog.openShareDialog(apiPath, title),
                    },
                  ]
                : []),
              {
                id: "rename",
                label: controller.labels.rename,
                icon: <Pencil />,
                disabled: !controller.canRename,
                onClick: controller.openRenameDialog,
              },
            ]}
          />
        ) : null
      }
    />
  );
}
