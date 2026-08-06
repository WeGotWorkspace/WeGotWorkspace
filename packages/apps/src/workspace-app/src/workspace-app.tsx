import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";

import { CollectionListWorkspace } from "@/collection-layout/src/collection-layout";
import { TooltipProvider } from "@/ui/tooltip";
import { cn } from "@/lib/utils";

import { WorkspaceAppLayout } from "@/workspace-shell/src/workspace-app-layout";
import { isSidebarOverlayViewport } from "@/workspace-shell/src/sidebar-breakpoint";
import "@/workspace-app/src/workspace-app.css";

export type WorkspaceAppChrome = {
  sidebarOpen: boolean;
  detailOpenMobile: boolean;
  toggleSidebar: () => void;
  closeSidebar: () => void;
  openMobileDetail: () => void;
  closeMobileDetail: () => void;
};

export type WorkspaceAppHandle = {
  openMobileDetail: () => void;
  closeMobileDetail: () => void;
  closeSidebar: () => void;
};

export type WorkspaceAppProps = {
  tooltipDelayDuration?: number;
  workspaceRoot: {
    style?: React.CSSProperties;
    className?: string;
  };
  sidebar: (chrome: WorkspaceAppChrome) => ReactNode;
  list: (chrome: WorkspaceAppChrome) => {
    header: ReactNode;
    listContent: ReactNode;
    hasItems: boolean;
    emptyLabel: string;
    floatingActionBar?: ReactNode;
    dropZone?: {
      active: boolean;
      overlay: ReactNode;
      onDragOver: (event: DragEvent) => void;
      onDragLeave: (event: DragEvent) => void;
      onDrop: (event: DragEvent) => void;
    };
  };
  /** Fixed toolbar above the scrollable detail body (e.g. back + item actions). */
  actionBar?: (chrome: WorkspaceAppChrome) => ReactNode;
  detail: (chrome: WorkspaceAppChrome) => ReactNode;
  /** Pinned below the scrollable detail body (e.g. stats / meta footer). */
  detailFooter?: (chrome: WorkspaceAppChrome) => ReactNode;
  /**
   * Optional wrapper around action bar + scroll body + footer (e.g. collab session
   * provider that must span the action bar and editor).
   */
  detailWrapper?: (children: ReactNode, chrome: WorkspaceAppChrome) => ReactNode;
  detailClassName?: string;
  /** Applied to the scroll container around `detail` (padding, overflow). */
  detailScrollClassName?: string;
};

/**
 * Two-pane workspace: app sidebar, list column, and detail panel with shared
 * mobile sidebar + detail-stack behavior. Use {@link WorkspaceAppHandle} from
 * a ref when list selection should open the detail on small screens (`WorkspaceAppHandle`).
 */
export const WorkspaceApp = forwardRef<WorkspaceAppHandle, WorkspaceAppProps>(function WorkspaceApp(
  {
    tooltipDelayDuration = 300,
    workspaceRoot,
    sidebar,
    list,
    actionBar,
    detail,
    detailFooter,
    detailWrapper,
    detailClassName,
    detailScrollClassName,
  },
  ref,
) {
  const [sidebarOpen, setSidebarOpen] = useState(() => !isSidebarOverlayViewport());
  const [detailOpenMobile, setDetailOpenMobile] = useState(false);

  const openMobileDetail = useCallback(() => setDetailOpenMobile(true), []);
  const closeMobileDetail = useCallback(() => setDetailOpenMobile(false), []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), []);

  const chrome: WorkspaceAppChrome = useMemo(
    () => ({
      sidebarOpen,
      detailOpenMobile,
      toggleSidebar,
      closeSidebar,
      openMobileDetail,
      closeMobileDetail,
    }),
    [
      sidebarOpen,
      detailOpenMobile,
      toggleSidebar,
      closeSidebar,
      openMobileDetail,
      closeMobileDetail,
    ],
  );

  useImperativeHandle(
    ref,
    () => ({
      openMobileDetail,
      closeMobileDetail,
      closeSidebar,
    }),
    [openMobileDetail, closeMobileDetail, closeSidebar],
  );

  const listProps = list(chrome);

  const detailChrome = (
    <>
      {actionBar?.(chrome)}
      <div className={cn("workspace-detail-pane__scroll", detailScrollClassName)}>
        {detail(chrome)}
      </div>
      {detailFooter?.(chrome)}
    </>
  );

  return (
    <TooltipProvider delayDuration={tooltipDelayDuration}>
      <WorkspaceAppLayout style={workspaceRoot.style} className={workspaceRoot.className}>
        {sidebar(chrome)}
        <CollectionListWorkspace
          detailOpenMobile={detailOpenMobile}
          header={listProps.header}
          listContent={listProps.listContent}
          hasItems={listProps.hasItems}
          emptyLabel={listProps.emptyLabel}
          floatingActionBar={listProps.floatingActionBar}
          dropZone={listProps.dropZone}
        />
        <main
          className={cn(
            "workspace-detail-pane",
            detailOpenMobile ? "translate-x-0" : "translate-x-full md:translate-x-0",
            detailClassName,
          )}
        >
          {detailWrapper ? detailWrapper(detailChrome, chrome) : detailChrome}
        </main>
      </WorkspaceAppLayout>
    </TooltipProvider>
  );
});

WorkspaceApp.displayName = "WorkspaceApp";
