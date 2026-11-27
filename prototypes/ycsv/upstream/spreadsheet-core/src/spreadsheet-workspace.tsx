import { useCallback, useEffect, useState } from "react";
import { Code2, Columns3, Pencil, Redo2, Undo2 } from "lucide-react";
import { TooltipProvider } from "@/ui/tooltip";
import { IconButton } from "@/button/src/button";
import { AppSidebar } from "@/app-sidebar/src/app-sidebar";
import {
  WorkspaceAppLayout,
  WorkspaceUserFooter,
} from "@/workspace-shell/src/workspace-app-layout";
import { workspaceUserInitials, type WorkspaceSession } from "@/lib/workspace/workspace-session";
import { ViewHeader } from "@/view-header/src/view-header";
import { cn } from "@/lib/utils";
import { SpreadsheetMainPane } from "@/spreadsheet-core/src/spreadsheet-main-pane";
import { SpreadsheetSheetsSidebar } from "@/spreadsheet-core/src/spreadsheet-sheets-sidebar";
import { SpreadsheetWorkspaceModals } from "@/spreadsheet-core/src/spreadsheet-workspace-modals";
import { useSpreadsheetController } from "@/spreadsheet-core/src/use-spreadsheet-controller";
import { useSpreadsheetKeyboardShortcuts } from "@/spreadsheet-core/src/use-spreadsheet-keyboard-shortcuts";
import type { SpreadsheetWorkspaceProps } from "@/spreadsheet-core/src/spreadsheet-workspace-props";
import "@/spreadsheet-core/src/spreadsheet-workspace.css";

type SpreadsheetControllerType = ReturnType<typeof useSpreadsheetController>;

export function SpreadsheetWorkspace({
  data,
  session,
  operations,
  filePath = null,
  labels,
  onLogout,
  onFileRenamed,
  className,
}: SpreadsheetWorkspaceProps) {
  const controller = useSpreadsheetController({
    filePath,
    labels,
    operations,
    initialDocument: data.document,
    onFileRenamed,
  });

  const fileKey = filePath ?? data.document?.apiPath ?? "mock";

  return (
    <TooltipProvider delayDuration={200}>
      <SpreadsheetWorkspaceShell
        className={className}
        controller={controller}
        fileKey={fileKey}
        session={session}
        onLogout={onLogout}
      />
      <SpreadsheetWorkspaceModals controller={controller} />
      {controller.confirmDialog}
    </TooltipProvider>
  );
}

function SpreadsheetWorkspaceShell({
  className,
  controller,
  fileKey,
  session,
  onLogout,
}: {
  className?: string;
  controller: SpreadsheetControllerType;
  fileKey: string;
  session: WorkspaceSession;
  onLogout?: () => void;
}) {
  const [viewSource, setViewSource] = useState(false);

  const handleSourceEscapeBlur = useCallback(() => {
    document.getElementById("spreadsheet-workspace-source-toggle")?.focus();
  }, []);

  useEffect(() => {
    setViewSource(false);
  }, [fileKey]);

  useSpreadsheetKeyboardShortcuts({
    undo: controller.undo,
    redo: controller.redo,
    clearSelection: controller.clearSelection,
    viewSource,
    formulaBarEditing: controller.fbEditing,
  });

  return (
    <WorkspaceAppLayout
      className={cn(
        "spreadsheet-workspace",
        viewSource && "spreadsheet-workspace--view-source",
        className,
      )}
      sidebar={
        <AppSidebar
          open={controller.sidebarOpen}
          onCloseMobile={() => controller.setSidebarOpen(false)}
          appSwitchSubtitle="Sheets"
          footer={
            <WorkspaceUserFooter
              name={session.user.displayName}
              initials={workspaceUserInitials(session.user)}
              detailLine={session.user.username}
              onLogoutClick={onLogout}
            />
          }
        >
          <SpreadsheetSheetsSidebar
            labels={controller.labels}
            sheets={controller.sheets}
            activeIndex={controller.activeSheetIndex}
            onAdd={controller.canAddSheet ? controller.addSheet : undefined}
            onRename={controller.canAddSheet ? controller.openSheetRenameDialog : undefined}
            onDelete={controller.canAddSheet ? controller.requestDeleteSheet : undefined}
            onSelect={(index) => {
              controller.setActiveSheetIndex(index);
              controller.setActiveCell(null);
              if (
                typeof window !== "undefined" &&
                window.matchMedia("(max-width: 767px)").matches
              ) {
                controller.setSidebarOpen(false);
              }
            }}
          />
        </AppSidebar>
      }
      mainHeader={
        <ViewHeader
          title={controller.title || controller.labels.emptyTitle}
          sidebarOpen={controller.sidebarOpen}
          onToggleSidebar={() => controller.setSidebarOpen((open) => !open)}
          actions={
            controller.hasFile ? (
              <div className="spreadsheet-workspace__header-actions">
                <IconButton
                  label={controller.labels.undo}
                  icon={<Undo2 />}
                  size="sm"
                  variant="subtle"
                  disabled={!controller.canUndo}
                  onClick={controller.undo}
                />
                <IconButton
                  label={controller.labels.redo}
                  icon={<Redo2 />}
                  size="sm"
                  variant="subtle"
                  disabled={!controller.canRedo}
                  onClick={controller.redo}
                />
                <IconButton
                  id="spreadsheet-workspace-source-toggle"
                  label={viewSource ? controller.labels.hideSource : controller.labels.viewSource}
                  icon={<Code2 />}
                  size="sm"
                  variant="subtle"
                  active={viewSource}
                  aria-pressed={viewSource}
                  className={
                    viewSource ? "spreadsheet-workspace__source-toggle--active" : undefined
                  }
                  onClick={() => setViewSource((on) => !on)}
                />
                <IconButton
                  label={
                    controller.schemaPanelOpen
                      ? controller.labels.schemaPanelClose
                      : controller.labels.schemaPanelToggle
                  }
                  icon={<Columns3 />}
                  size="sm"
                  variant="subtle"
                  active={controller.schemaPanelOpen}
                  aria-pressed={controller.schemaPanelOpen}
                  className={
                    controller.schemaPanelOpen
                      ? "spreadsheet-workspace__schema-toggle--active"
                      : undefined
                  }
                  onClick={() => controller.setSchemaPanelOpen((open) => !open)}
                />
                <IconButton
                  label={controller.labels.rename}
                  icon={<Pencil />}
                  size="sm"
                  variant="subtle"
                  disabled={!controller.canRename}
                  onClick={controller.openRenameDialog}
                />
              </div>
            ) : null
          }
        />
      }
      main={
        <SpreadsheetMainPane
          controller={controller}
          viewSource={viewSource}
          onSourceEscapeBlur={handleSourceEscapeBlur}
        />
      }
    />
  );
}
