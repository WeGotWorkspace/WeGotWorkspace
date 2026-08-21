import { X } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { IconButton } from "@/button/src/button";
import { ViewHeader } from "@/view-header/src/view-header";
import "./docs-collab-sidebar-panel.css";

export type DocsCollabSidebarPanelProps = {
  className?: string;
  ariaLabel: string;
  title: string;
  /** "default" = large serif display; "sm" = compact sans-serif (comments/suggestions panels). */
  titleSize?: "default" | "sm";
  countLabel?: string;
  closeLabel: string;
  onClose: () => void;
  /** When true, renders a close action in the panel header (mobile drawer). */
  showCloseButton?: boolean;
  headerActions?: ReactNode;
  /** Pinned below the title row (filters, segmented controls). */
  toolbar?: ReactNode;
  scrollRef?: RefObject<HTMLDivElement | null>;
  empty?: boolean;
  emptyLabel?: string;
  listClassName?: string;
  children: ReactNode;
};

export function DocsCollabSidebarPanel({
  className,
  ariaLabel,
  title,
  titleSize = "sm",
  countLabel,
  closeLabel,
  onClose,
  showCloseButton = false,
  headerActions,
  toolbar,
  scrollRef,
  empty = false,
  emptyLabel,
  listClassName = "docs-collab-sidebar-panel__list",
  children,
}: DocsCollabSidebarPanelProps) {
  return (
    <aside
      className={className ? `docs-collab-sidebar-panel ${className}` : "docs-collab-sidebar-panel"}
      aria-label={ariaLabel}
    >
      <header className="docs-collab-sidebar-panel__header">
        <ViewHeader
          hideSidebarToggle
          title={title}
          titleSize={titleSize}
          subtitle={countLabel || undefined}
          actions={
            headerActions || showCloseButton ? (
              <div className="docs-collab-sidebar-panel__header-actions">
                {headerActions}
                {showCloseButton ? (
                  <IconButton
                    label={closeLabel}
                    icon={<X className="size-4" aria-hidden />}
                    size="sm"
                    variant="subtle"
                    showTooltip={false}
                    onClick={onClose}
                  />
                ) : null}
              </div>
            ) : null
          }
        />
        {toolbar ? <div className="docs-collab-sidebar-panel__toolbar">{toolbar}</div> : null}
      </header>

      <div ref={scrollRef} className="docs-collab-sidebar-panel__scroll">
        {empty && emptyLabel ? (
          <p className="docs-collab-sidebar-panel__empty">{emptyLabel}</p>
        ) : (
          <div className={listClassName}>{children}</div>
        )}
      </div>
    </aside>
  );
}
