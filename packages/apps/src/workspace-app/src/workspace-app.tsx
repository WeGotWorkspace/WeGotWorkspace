import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";

import { CollectionListWorkspace } from "@/collection-layout/src/collection-layout";
import { TooltipProvider } from "@/ui/tooltip";
import { runViewTransition } from "@/lib/view-transition";
import { cn } from "@/lib/utils";

import { WorkspaceAppLayout } from "@/workspace-shell/src/workspace-app-layout";
import { isSidebarOverlayViewport } from "@/workspace-shell/src/sidebar-breakpoint";
import { isCollectionDetailOverlayViewport } from "@/workspace-app/src/collection-detail-breakpoint";
import "@/workspace-app/src/workspace-app.css";

/** Runs inside the same View Transition as opening/closing the mobile detail overlay. */
export type MobileDetailDuring = () => void | Promise<void>;

export type WorkspaceAppChrome = {
  sidebarOpen: boolean;
  detailOpenMobile: boolean;
  toggleSidebar: () => void;
  closeSidebar: () => void;
  openMobileDetail: (during?: MobileDetailDuring) => void;
  closeMobileDetail: (during?: MobileDetailDuring) => void;
};

export type WorkspaceAppHandle = {
  openMobileDetail: (during?: MobileDetailDuring) => void;
  closeMobileDetail: (during?: MobileDetailDuring) => void;
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
  /**
   * First paint of the mobile overlay (e.g. deep-link `/notes/all/:noteId`).
   * Remounts after a route change must start open/closed from the URL so the
   * View Transition captures the right new snapshot.
   */
  initialDetailOpenMobile?: boolean;
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
    initialDetailOpenMobile = false,
  },
  ref,
) {
  const [sidebarOpen, setSidebarOpen] = useState(() => !isSidebarOverlayViewport());
  const [detailOpenMobile, setDetailOpenMobile] = useState(initialDetailOpenMobile);
  const detailOpenMobileRef = useRef(detailOpenMobile);
  detailOpenMobileRef.current = detailOpenMobile;

  const setMobileDetailOpen = useCallback((open: boolean, during?: MobileDetailDuring) => {
    const already = detailOpenMobileRef.current === open;
    const apply = () => {
      if (!already) setDetailOpenMobile(open);
      return during?.();
    };
    if (already && !during) return;
    if (!isCollectionDetailOverlayViewport()) {
      void Promise.resolve(apply());
      return;
    }
    if (already) {
      void Promise.resolve(during?.());
      return;
    }
    runViewTransition(apply);
  }, []);

  const openMobileDetail = useCallback(
    (during?: MobileDetailDuring) => setMobileDetailOpen(true, during),
    [setMobileDetailOpen],
  );
  const closeMobileDetail = useCallback(
    (during?: MobileDetailDuring) => setMobileDetailOpen(false, during),
    [setMobileDetailOpen],
  );
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
          header={listProps.header}
          listContent={listProps.listContent}
          hasItems={listProps.hasItems}
          emptyLabel={listProps.emptyLabel}
          floatingActionBar={listProps.floatingActionBar}
          dropZone={listProps.dropZone}
        />
        <main
          className={cn("workspace-detail-pane", detailClassName)}
          data-open={detailOpenMobile ? "true" : "false"}
        >
          {detailWrapper ? detailWrapper(detailChrome, chrome) : detailChrome}
        </main>
      </WorkspaceAppLayout>
    </TooltipProvider>
  );
});

WorkspaceApp.displayName = "WorkspaceApp";
