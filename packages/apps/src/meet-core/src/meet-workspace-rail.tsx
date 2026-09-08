import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { IconButton } from "@/button/src/button";
import { DocsCollabSidebarPanel } from "@/text-editor-core/docs-collab/docs-collab-card";
import { WorkspacePanelScrim } from "@/workspace-shell/src/workspace-app-layout";
import "@/workspace-shell/src/workspace-app-layout.css";

export type MeetWorkspaceRailProps = {
  open: boolean;
  title: string;
  closeLabel: string;
  onClose: () => void;
  /** Expanded-call thread: return to channel chat in this same rail. */
  onBack?: () => void;
  backLabel?: string;
  /** Trailing ViewHeader actions before close (e.g. thread edit/delete). */
  headerActions?: ReactNode;
  children?: ReactNode;
};

/** One right-hand workspace panel — overlay scrim + docked flex; contents are a slot. */
export function MeetWorkspaceRail({
  open,
  title,
  closeLabel,
  onClose,
  onBack,
  backLabel,
  headerActions,
  children,
}: MeetWorkspaceRailProps) {
  return (
    <>
      <WorkspacePanelScrim open={open} onClick={onClose} />
      <div
        className="workspace-app-layout__panel meet-workspace__rail"
        data-open={open ? "true" : "false"}
        aria-hidden={!open}
        inert={!open || undefined}
      >
        <DocsCollabSidebarPanel
          className="meet-workspace__rail-panel"
          ariaLabel={title}
          title={title}
          titleSize="default"
          closeLabel={closeLabel}
          onClose={onClose}
          showCloseButton
          headerActions={headerActions}
          titleLeading={
            onBack ? (
              <IconButton
                icon={<ChevronLeft />}
                label={backLabel ?? "Back"}
                size="sm"
                variant="subtle"
                showTooltip={false}
                onClick={onBack}
              />
            ) : undefined
          }
        >
          {children}
        </DocsCollabSidebarPanel>
      </div>
    </>
  );
}
